import React, { useState, useEffect, useCallback, useMemo } from 'react';

// Firebase Imports (필수 라이브러리)
import { initializeApp } from 'firebase/app';
import { 
    getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged, 
    signOut, GoogleAuthProvider, signInWithPopup 
} from 'firebase/auth';
import { 
    getFirestore, doc, getDoc, setDoc, onSnapshot, collection, query, where, updateDoc,
    serverTimestamp, addDoc, arrayUnion, arrayRemove, deleteDoc
} from 'firebase/firestore';

// Lucide React Icons
import { BookOpen, Utensils, Zap, NotebookText, Users, HelpCircle, CornerDownLeft, Send, Loader2, Bot, LogIn, User, X, Sparkles, Play, Square, List, CheckCircle, XCircle, ChevronDown, LogOut } from 'lucide-react';

// --- 전역 변수 설정 (Canvas 환경에서 제공됨) ---
const appId = 'sangam-study-planner'; // 프로젝트 ID 대신 고유 ID 사용 (규칙에서 설정한 값)
const firebaseConfig = {      
    // [사용자 제공 키 적용 완료]
    apiKey: "AIzaSyCeHxl1yCqXpqg0DzJbN3PmLJW3GJuKOhI", // <-- 실제 키
    authDomain: "sangam-study-planner.firebaseapp.com",
    projectId: "sangam-study-planner",
    storageBucket: "sangam-study-planner.firebasestorage.app",
    messagingSenderId: "714190621494",
    appId: "1:714190621494:web:eda5e67bdd80c87378c197",
    measurementId: "G-XBN5FB1BV0"
};
const initialAuthToken = null; // 변경 불필요

// API Key (Gemini 호출 시 사용)
const GEMINI_API_KEY = ""; 

const modelName = 'gemini-2.5-flash-preview-09-2025';
const imageUrlModel = 'imagen-4.0-generate-001';

// --- 유틸리티 함수 ---

/**
 * 정수 범위 내에서 랜덤 정수를 생성합니다.
 */
const getRandomInt = (min, max) => {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
};

/**
 * 지연 시간 기반으로 재시도하는 fetch 함수
 */
const fetchWithRetry = async (url, options, retries = 3) => {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response;
        } catch (error) {
            if (i < retries - 1) {
                const delay = Math.pow(2, i) * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                console.error("Fetch failed after all retries:", error);
                throw error;
            }
        }
    }
};

/**
 * Gemini API를 호출하여 텍스트를 생성합니다.
 */
const generateGeminiContent = async (userQuery, base64Image = null) => {
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;

    const contents = [{ 
        parts: base64Image ? [
            { text: userQuery },
            { 
                inlineData: {
                    mimeType: "image/png",
                    data: base64Image 
                }
            }
        ] : [{ text: userQuery }]
    }];

    const payload = {
        contents: contents,
        systemInstruction: {
            parts: [{ text: "당신은 한국 고등학생을 위한 전문 학습 튜터입니다. 질문에 대해 친절하고 명확하게 답변해 주세요." }]
        }
    };

    try {
        const response = await fetchWithRetry(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || "답변을 생성하는 데 문제가 발생했습니다.";
        
        return text;

    } catch (error) {
        console.error("Gemini API 호출 오류:", error);
        return "죄송합니다. AI 튜터 연결에 문제가 발생했습니다.";
    }
};

/**
 * 초 단위 시간을 'HH시간 MM분 SS초' 형식으로 포맷합니다.
 */
const formatTime = (totalSeconds) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    const pad = (num) => String(num).padStart(2, '0');
    
    return `${pad(hours)}시간 ${pad(minutes)}분 ${pad(seconds)}초`;
};


/**
 * 퀴즈 텍스트 정제 함수 (HTML 줄바꿈만 처리)
 */
const formatQuizText = (text) => {
    if (!text) return "";
    return text.replace(/\\\\/g, '<br/>'); // 줄바꿈만 HTML로 변환
};


// --- 초기 데이터 및 상수 ---

/**
 * 계수가 1일 때 생략, 최고차항의 양수 부호 생략 규칙을 적용합니다.
 * @param {number} coef - 계수
 * @param {string} variable - 변수 문자열 (x³, x², x 등)
 * @param {boolean} isFirstTerm - 첫 번째 항인지 여부
 * @param {boolean} isFinalTerm - C를 포함해야 하는 적분식의 마지막 항인지 여부
 * @returns {string} 정제된 수식 문자열
 */
const formatCoefficient = (coef, variable = '', isFirstTerm = false, isFinalTerm = false) => {
    if (coef === 0 && !isFinalTerm) return '';
    if (coef === 0 && isFinalTerm) return ' + C';

    const absCoef = Math.abs(coef);
    let coefStr = '';
    
    // 1. 계수 문자열 결정
    if (variable === '') { // 상수항 (계수 1은 생략하지 않음)
        coefStr = absCoef.toString();
    } else if (absCoef === 1) { // 변수항, 계수 1 생략
        coefStr = '';
    } else { // 변수항, 계수 1 외의 숫자 표시
        coefStr = absCoef.toString();
    }

    // 2. 부호 및 공백 결정
    let sign = '';
    if (coef < 0) {
        sign = ' - '; // 음수일 때는 항상 - 부호와 공백
    } else if (coef > 0 && !isFirstTerm) {
        sign = ' + '; // 양수이고 첫 항이 아닐 때만 + 부호와 공백
    }
    
    // 3. 최종 조립
    let result = `${sign}${coefStr}${variable}`;
    
    // 4. 불필요한 공백 제거 및 첫 항 양수 부호 제거
    result = result.trim();
    if (isFirstTerm && result.startsWith('+')) {
        result = result.substring(1).trim();
    }

    // 5. 최종 항 처리 (적분 상수 C)
    if (isFinalTerm) {
        result += ' + C';
    }
    
    return result;
};


const MATH_QUIZ_TEMPLATES = [
    // M1: 도함수 기본 연산 (ax^3 + bx + c)
    (a, b, c, d) => {
        const derivative = formatCoefficient(3 * a, 'x²', true) + formatCoefficient(b, 'x', false); 
        return {
            id: `m-gen-m1-${a}${b}${c}${d}`,
            text: `함수 f(x) = ${a}x³ + ${b}x + ${d}의 도함수 f'(x)를 구하시오.`,
            subject: '수학', unit: '미분 연산',
            answer: derivative.trim(),
            options: [`${3 * a}x² + ${b}x`, derivative.trim(), `${a}x² + ${b}`, `${a}x³ + ${b}`].map(opt => opt.trim()).sort(() => Math.random() - 0.5)
        }
    },
    // M2: 미분계수 (x=k에서의 기울기)
    (a, b, c) => {
        const answer = 4 * a - b;
        return {
            id: `m-gen-m2-${a}${b}${c}`,
            text: `곡선 y = ${a}x² - ${b}x + ${c} 위의 x=2인 지점에서의 접선의 기울기를 구하시오.`,
            subject: '수학', unit: '미분계수',
            answer: `${answer}`, // Numerical answer, no variable
            options: [`${answer + 2}`, `${answer}`, `${2 * a + b}`, `${a + b}`].map(opt => opt.trim()).sort(() => Math.random() - 0.5)
        }
    },
    // M3: 부정적분 기본 연산
    (a, b) => {
        const integral = formatCoefficient(a, 'x³', true) + formatCoefficient(b, 'x²', false, true);
        return {
            id: `m-gen-m3-${a}${b}`,
            text: `부정적분 ∫ (${3 * a}x² + ${2 * b}x) dx를 구하시오.`,
            subject: '수학', unit: '부정적분',
            answer: integral.trim(),
            options: [`${3 * a}x + ${2 * b} + C`, integral.trim(), `${3 * a}x³ + ${2 * b}x² + C`, `x⁴ + x³ + C`].map(opt => opt.trim()).sort(() => Math.random() - 0.5)
        }
    },
    // M4: 미분계수 (x=k에서의 미분계수)
    (a, b) => {
        const answer = 3 * a - 2 * b;
        return {
            id: `m-gen-m4-${a}${b}`,
            text: `함수 f(x) = ${a}x³ - ${b}x² + 5에 대하여 x=1에서의 미분계수 f'(1)을 구하시오.`,
            subject: '수학', unit: '미분계수',
            answer: `${answer}`, 
            options: [`${answer}`, `${answer + 2}`, `${a + b + 5}`, `${3 * a - b}`].map(opt => opt.trim()).sort(() => Math.random() - 0.5)
        }
    },
    // M5 (New): 부정적분 기본 연산 (x^4)
    (a, b) => {
        const integral = formatCoefficient(a, 'x⁴', true) + formatCoefficient(b, 'x²', false, true);
        return {
            id: `m-gen-new1-${a}${b}`,
            text: `부정적분 ∫ (${4 * a}x³ + ${2 * b}x) dx를 구하시오.`,
            subject: '수학', unit: '부정적분',
            answer: integral.trim(),
            options: [integral.trim(), `${a}x³ + ${b}x`, `4x⁴ + ${b}x + C`, `${4 * a}x⁴ + ${2 * b}x²`].map(opt => opt.trim()).sort(() => Math.random() - 0.5)
        }
    },
    // M6 (New): 다항식 미분 연산 (곱의 미분 재구성)
    (a, b, k) => {
        const derivative = formatCoefficient(6, 'x²', true) + formatCoefficient(-2 * b, 'x', false) + formatCoefficient(2 * a, '', false);
        return {
            id: `m-gen-new2-${a}${b}${k}`,
            text: `함수 f(x) = (x² + ${a})(2x - ${b})의 도함수 f'(x)를 구하시오.`, 
            subject: '수학', unit: '미분 연산',
            answer: derivative.trim(),
            options: [derivative.trim(), `${6}x² - ${b}x`, `${2}x² + ${2 * a}`, `${6}x² + ${2 * a}`].map(opt => opt.trim()).sort(() => Math.random() - 0.5)
        }
    },
];

const ENGLISH_VOCAB_DEFINITION = [
    { word: 'reliable', meaning: '믿을 수 있는' },
    { word: 'promote', meaning: '증진[촉진]하다' },
    { word: 'adjust', meaning: '적응하다' },
    { word: 'predict', meaning: '예언하다' },
    { word: 'install', meaning: '설치하다' },
    { word: 'alternative', meaning: '대안' },
    { word: 'variable', meaning: '변하기 쉬운' },
    { word: 'various', meaning: '다양한' },
    { word: 'varied', meaning: '가지각색의' },
    { word: 'appoint', meaning: '임명[지명]하다' },
    { word: 'locate', meaning: '위치하다' },
    { word: 'celebrity', meaning: '유명 인사' },
    { word: 'handle', meaning: '처리하다' },
    { word: 'originate', meaning: '생기다' },
    { word: 'aware', meaning: '알아차린' },
    { word: 'caution', meaning: '조심' },
    { word: 'barrier', meaning: '장애' },
    { word: 'anticipate', meaning: '예상하다' },
    { word: 'breed', meaning: '번식하다' },
    { word: 'commit', meaning: '범하다' },
    { word: 'hence', meaning: '따라서' },
    { word: 'theorize', meaning: '세우다' },
    { word: 'assert', meaning: '주장하다' },
    { word: 'distribute', meaning: '나누어 주다' },
    { word: 'exclude', meaning: '제외하다' },
    { word: 'approach', meaning: '접근하다' },
    { word: 'nevertheless', meaning: '그럼에도 불구하고' },
    { word: 'fair', meaning: '공평한' },
    { word: 'attempt', meaning: '시도' },
    { word: 'merely', meaning: '한낱' },
    { word: 'comfort', meaning: '위로' },
    { word: 'import', meaning: '수입하다' },
    { word: 'register', meaning: '등록하다' },
    { word: 'accuse', meaning: '고발하다' },
    { word: 'include', meaning: '포함하다' },
    { word: 'prohibit', meaning: '금지하다' },
    { word: 'transmit', meaning: '전송하다' },
    { word: 'sustain', meaning: '지탱하다' },
    { word: 'exploit', meaning: '착취하다' },
    { word: 'interpret', meaning: '해석하다' },
    { word: 'derive', meaning: '끌어내다' },
    { word: 'evolve', meaning: '진화하다' },
    { word: 'contribute', meaning: '기여하다' },
    { word: 'involve', meaning: '관련시키다' },
    { word: 'modify', meaning: '수정하다' },
    { word: 'neglect', meaning: '무시하다' },
    { word: 'obtain', meaning: '얻다' },
    { word: 'persuade', meaning: '설득하다' },
    { word: 'reject', meaning: '거절하다' },
    { word: 'reveal', meaning: '드러내다' },
    { word: 'sequence', meaning: '순서' },
    { word: 'skeptical', meaning: '회의적인' },
    { word: 'substance', meaning: '물질' },
    { word: 'vulnerable', meaning: '취약한' },
    { word: 'utilize', meaning: '활용하다' },
];


/**
 * 옵션 배열의 중복을 제거하고 4개로 맞춘 후 무작위로 섞습니다.
 */
const makeOptionsUniqueAndShuffle = (correctAnswer, rawOptions) => {
    const optionsSet = new Set();
    optionsSet.add(correctAnswer.trim()); // 정답을 먼저 추가

    // 원본 옵션을 추가하여 고유한 셋을 만듭니다.
    rawOptions.forEach(opt => optionsSet.add(opt.trim()));

    let uniqueOptions = Array.from(optionsSet).filter(opt => opt !== ""); // 빈 문자열 제거
    
    // 만약 4개 미만이라면, 무작위 오답을 추가합니다.
    while (uniqueOptions.length < 4) {
        let dummy = (uniqueOptions.length * 1000 + getRandomInt(1, 99)).toString();
        
        // 수학 문제인 경우, 간단한 변형 답안을 생성하여 혼란을 방지합니다.
        if (correctAnswer.includes('x') || correctAnswer.includes('C')) {
             dummy = '다른 답안 ' + getRandomInt(1, 100);
        } else if (correctAnswer.length < 5) {
            // 짧은 단답형(숫자)인 경우, 숫자를 +-1 또는 +-2 한 것을 추가합니다.
            const numAnswer = parseInt(correctAnswer);
            if (!isNaN(numAnswer)) {
                dummy = (numAnswer + (uniqueOptions.length % 2 === 0 ? 1 : -1)).toString();
            }
        }
        
        if (!uniqueOptions.includes(dummy.trim())) {
            uniqueOptions.push(dummy.trim());
        }
    }
    
    // 4개로 잘라내고 섞습니다.
    return uniqueOptions.slice(0, 4).sort(() => Math.random() - 0.5);
};

/**
 * 수학 퀴즈 10문제를 랜덤하게 생성합니다.
 */
const generateMathQuiz = () => {
    const quizList = [];
    // MATH_QUIZ_TEMPLATES에는 6가지 템플릿이 있습니다. (0~5 인덱스)
    const availableTemplates = [0, 1, 2, 3, 4, 5]; 

    for (let i = 0; i < 10; i++) {
        // 랜덤한 템플릿 인덱스를 선택
        const templateIndex = availableTemplates[getRandomInt(0, availableTemplates.length - 1)];
        const template = MATH_QUIZ_TEMPLATES[templateIndex];

        // 랜덤 인자 생성
        const a = getRandomInt(1, 3);
        const b = getRandomInt(2, 6); 
        const c = getRandomInt(1, 5);
        const d = getRandomInt(1, 10);
        const k = getRandomInt(3, 7); 
        const k_small = getRandomInt(1, 3); // M6 템플릿용

        let newQuiz;
        // 템플릿에 따라 인자를 전달하여 문제 생성
        switch (templateIndex) {
            case 0: newQuiz = template(a, b, c, d); break;
            case 1: newQuiz = template(a, b, c); break;
            case 2: newQuiz = template(a, b); break;
            case 3: newQuiz = template(a, b); break;
            case 4: newQuiz = template(a, b * 2); break; 
            case 5: newQuiz = template(a, b, k_small); break;
            default: newQuiz = MATH_QUIZ_TEMPLATES[0](1, 1, 1, 1);
        }
        
        // 1. 옵션 중복 제거 및 셔플 적용
        const uniqueOptions = makeOptionsUniqueAndShuffle(newQuiz.answer, newQuiz.options);

        // 2. 최종 퀴즈 객체 생성
        quizList.push({
            id: `math-gen-${i}-${Date.now() + i}`,
            text: newQuiz.text, // 템플릿에서 이미 유니코드/평문 처리됨
            subject: '수학',
            unit: newQuiz.unit,
            answer: newQuiz.answer,
            options: uniqueOptions
        });
    }
    return quizList;
};

/**
 * 영어 퀴즈 10문제를 랜덤하게 생성합니다.
 */
const generateEnglishQuiz = () => {
    const quizList = [];
    const usedWords = new Set();
    const NUM_QUESTIONS = 10;
    
    // 문제를 NUM_QUESTIONS개 생성
    while (quizList.length < NUM_QUESTIONS) {
        const pool = ENGLISH_VOCAB_DEFINITION.filter(v => !usedWords.has(v.word));
        if (pool.length === 0) break; 

        const correctItem = pool[getRandomInt(0, pool.length - 1)];
        usedWords.add(correctItem.word);
        
        // 오답 보기 3개 선택 (정답을 제외한 다른 단어의 의미)
        const rawIncorrectOptions = ENGLISH_VOCAB_DEFINITION
            .filter(v => v.word !== correctItem.word)
            .sort(() => Math.random() - 0.5)
            .slice(0, 3)
            .map(v => v.meaning); 
        
        // 1. 옵션 중복 제거 및 셔플 적용
        const uniqueOptions = makeOptionsUniqueAndShuffle(correctItem.meaning, rawIncorrectOptions);

        // 2. 최종 퀴즈 객체 생성
        quizList.push({
            id: `eng-gen-${quizList.length}-${Date.now() + quizList.length}`,
            text: `'${correctItem.word}'의 가장 정확한 한국어 뜻은 무엇인가요?`,
            subject: '영어',
            unit: '영단어',
            answer: correctItem.meaning,
            options: uniqueOptions
        });
    }
    
    return quizList;
};

const QUIZ_DATA_INITIAL = [...generateMathQuiz().slice(0, 5), ...generateEnglishQuiz().slice(0, 5)]; // 초기 로딩용 (간소화)


const navItems = [
    { id: 'studyGroup', label: '스터디 그룹', icon: Users },    // 1. 스터디 그룹
    { id: 'liveQuiz', label: '실시간 퀴즈', icon: Zap },        // 2. 실시간 퀴즈
    { id: 'quiz', label: '퀴즈', icon: BookOpen },             // 3. 퀴즈 (메인/중앙)
    { id: 'errorNote', label: '오답 노트', icon: NotebookText },  // 4. 오답 노트 (아이콘 이름 수정)
    { id: 'meal', label: '급식 알리미', icon: Utensils },     // 5. 급식 알리미
];

// --- Firebase 및 인증 Context 설정 ---
let db, auth;

// --- 핵심 컴포넌트 ---

/**
 * 퀴즈 화면 캡처 및 Base64 변환 (웹 전용)
 */
const captureQuizScreen = (ref) => {
    const dummyBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIwAAAABJRU5ErkJggg==";
    console.log("화면 캡처 시도 (실제 구현 필요)");
    
    const quizContent = ref.current ? ref.current.innerText : "퀴즈 화면을 캡처했습니다.";
    
    return { base64: dummyBase64, textPrompt: quizContent.substring(0, 100) }; 
};

/**
 * Gemini AI 튜터 채팅 모달
 */
const GeminiChatModal = ({ isOpen, onClose, initialImageBase64 = null, initialImageText = "" }) => {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [imageBase64, setImageBase64] = useState(initialImageBase64);
    const [imageText, setImageText] = useState(initialImageText);

    useEffect(() => {
        setImageBase64(initialImageBase64);
        setImageText(initialImageText);
        setMessages([]);

        if (initialImageBase64) {
             setMessages([{ sender: 'system', text: "퀴즈 화면을 캡처했어요. 이 문제에 대해 궁금한 점을 질문해 보세요." }]);
        } else {
             setMessages([{ sender: 'system', text: "무엇이든 물어보세요! 국영수 학습을 도와드릴게요." }]);
        }
    }, [isOpen, initialImageBase64, initialImageText]);

    if (!isOpen) return null;

    const handleSend = async () => {
        if (!input.trim() && !imageBase64) return;

        const newUserMessage = { sender: 'user', text: input || "캡처한 문제에 대해 질문합니다.", imageBase64 };
        
        setMessages(prev => [...prev, newUserMessage]);
        
        const queryText = input.trim();
        setInput("");
        setIsLoading(true);

        try {
            let fullQuery = queryText;
            if (imageBase64 && imageText) {
                fullQuery = `[캡처된 퀴즈 내용: ${imageText.replace(/\n/g, ' ')}] ${queryText}`;
            }

            const responseText = await generateGeminiContent(fullQuery, base64Image);
            
            setMessages(prev => [...prev, { sender: 'gemini', text: responseText }]);
        } catch (error) {
            setMessages(prev => [...prev, { sender: 'gemini', text: "죄송합니다. 답변을 가져오는 중 오류가 발생했습니다." }]);
        } finally {
            setIsLoading(false);
            setImageBase64(null);
            setImageText("");
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg h-3/4 flex flex-col p-4 m-4">
                <div className="flex justify-between items-center pb-3 border-b border-gray-100">
                    <h2 className="text-xl font-bold text-indigo-700 flex items-center"><Bot className="mr-2" />AI 튜터 (Gemini)</h2>
                    <button onClick={onClose} className="text-gray-500 hover:text-red-500 font-semibold p-2">
                        닫기
                    </button>
                </div>
                
                <div className="flex-grow overflow-y-auto space-y-4 pt-4 mb-2">
                    {messages.map((msg, index) => (
                        <div key={index} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-xs md:max-w-md p-3 rounded-xl shadow-md ${
                                msg.sender === 'user' 
                                    ? 'bg-indigo-500 text-white rounded-br-none' 
                                    : 'bg-gray-100 text-gray-800 rounded-tl-none'
                            }`}>
                                {msg.imageBase64 && (
                                    <div className="mb-2 border border-indigo-200 rounded-lg p-2 bg-white">
                                        <p className="text-xs text-indigo-500">캡처된 퀴즈 화면 (Gemini에게 전달)</p>
                                    </div>
                                )}
                                <p className="whitespace-pre-wrap">{msg.text}</p>
                            </div>
                        </div>
                    ))}
                    {isLoading && (
                        <div className="flex justify-start">
                            <div className="bg-gray-100 text-gray-500 p-3 rounded-xl rounded-tl-none shadow-md flex items-center">
                                <Loader2 className="animate-spin mr-2 h-4 w-4" /> 
                                답변 생성 중...
                            </div>
                        </div>
                    )}
                </div>

                <div className="border-t border-gray-200 pt-4 flex items-center">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                        placeholder="궁금한 점을 질문해 보세요..."
                        className="flex-grow p-3 border border-gray-300 rounded-l-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition duration-150"
                        disabled={isLoading}
                    />
                    <button
                        onClick={handleSend}
                        className="bg-indigo-600 text-white p-3 rounded-r-lg hover:bg-indigo-700 transition duration-150 flex items-center justify-center disabled:opacity-50"
                        disabled={isLoading}
                    >
                        <Send className="w-5 h-5" />
                    </button>
                </div>
            </div>
        </div>
    );
};

/**
 * 로그인 상태 확인 및 데이터베이스 초기화
 */
const AuthAndDBSetup = () => {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    const initializeFirebase = useCallback(async () => {
        try {
            if (Object.keys(firebaseConfig).length === 0) {
                console.warn("Firebase 설정(__firebase_config)이 제공되지 않아 더미 데이터로 실행됩니다.");
                setLoading(false);
                return;
            }
            
            // Firebase 초기화
            const app = initializeApp(firebaseConfig);
            db = getFirestore(app);
            auth = getAuth(app);

            // 인증 처리
            await new Promise(resolve => {
                const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
                    if (currentUser) {
                        setUser(currentUser);
                        setIsAuthenticated(true);
                        console.log("Firebase Auth Status: Logged in (UID:", currentUser.uid, ", Anonymous:", currentUser.isAnonymous, ")");
                    } else {
                        // 초기 토큰이 있으면 로그인 시도, 없으면 익명 로그인 (admin-restricted-operation 오류 방지용 로직)
                        try {
                            if (initialAuthToken) {
                                // 1. Custom token sign-in 시도
                                await signInWithCustomToken(auth, initialAuthToken);
                            } else {
                                // 2. 토큰이 없으면 익명 로그인 시도
                                await signInAnonymously(auth);
                            }
                        } catch (e) {
                            console.error("Initial/Custom Token Sign-in Failed:", e);
                            
                            // 3. 오류 발생 시, 세션을 정리하고 익명 로그인 재시도
                            // (auth/admin-restricted-operation 오류 회피의 핵심)
                            try {
                                await signOut(auth); // 현재 세션 정리
                                await signInAnonymously(auth); // 클린 세션 생성
                                console.log("Sign-in failed, successfully recovered with Anonymous sign-in.");
                            } catch (anonError) {
                                console.error("Anonymous Fallback sign-in failed (Critical):", anonError);
                                // 이 시점에서도 실패하면 Firebase 설정 문제(익명 제공업체 비활성화)가 확실합니다.
                            }
                        }
                    }
                    setLoading(false);
                    unsubscribe(); 
                    resolve();
                });
            });

        } catch (error) {
            console.error("Firebase 초기화 중 오류 발생:", error);
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        initializeFirebase();
    }, [initializeFirebase]);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <Loader2 className="animate-spin text-indigo-500 h-8 w-8" />
                <p className="ml-3 text-lg text-gray-600">데이터 로딩 및 인증 중...</p>
            </div>
        );
    }

    if (!user) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
                <div className="bg-white p-8 rounded-xl shadow-lg text-center">
                    <LogIn className="w-10 h-10 mx-auto text-indigo-500 mb-4" />
                    <h1 className="text-2xl font-bold text-gray-800 mb-2">로그인 필요</h1>
                    <p className="text-gray-600 mb-6">사용자 인증에 실패했습니다. Firebase 설정 확인이 필요합니다.</p>
                </div>
            </div>
        );
    }

    // 인증 완료 후 App 컴포넌트 렌더링
    return <App user={user} isAuthenticated={isAuthenticated} />;
};

// ************************************************
// ********* 급식 알리미 컴포넌트 *********
// ************************************************
const MealTab = ({ user }) => {
    // 20251201는 샘플 데이터입니다. 실제 NEIS API를 사용하려면 서버리스 함수가 필요합니다.
    // NOTE: 실제 환경에서 Cloud Function을 사용한다면 이 BASE URL은 함수의 엔드포인트로 변경됩니다.
    const NEIS_API_BASE = 'https://open.neis.go.kr/hub/mealServiceDietInfo?ATPT_OFCDC_SC_CODE=B10&SD_SCHUL_CODE=7010806&Type=json';
    
    const today = useMemo(() => {
        const d = new Date();
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }, []);

    const [selectedDate, setSelectedDate] = useState(today);
    const [mealData, setMealData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const fetchMealData = useCallback(async (date) => {
        setLoading(true);
        setError(null);
        setMealData(null);
        
        const apiDate = date.replace(/-/g, ''); // YYYYMMDD 형식
        const url = `${NEIS_API_BASE}&MLSV_YMD=${apiDate}`;

        try {
            // 이 URL을 직접 호출하면 CORS 문제가 발생할 수 있으며, 속도 개선을 위해서는 서버리스 프록시가 필요합니다.
            const response = await fetchWithRetry(url, { method: 'GET' });
            const data = await response.json();

            if (data.mealServiceDietInfo) {
                // 급식 데이터가 있을 경우 (중식/석식 등 여러 개일 수 있음)
                const meals = data.mealServiceDietInfo[1].row.map(item => ({
                    menu: item.DDISH_NM.replace(/\<br\/\>/g, '\n').replace(/\([0-9\.]+\)/g, ''), // 알레르기 정보 제거
                    time: item.MMEAL_SC_NM, // 조식, 중식, 석식
                }));
                setMealData(meals);
            } else if (data.RESULT && data.RESULT.CODE === 'INFO-200') {
                // 데이터 없음 (INFO-200)
                setMealData([]); 
            } else {
                setError('급식 정보를 가져오는 데 실패했습니다.');
            }
        } catch (e) {
            console.error("급식 API 오류:", e);
            setError('네트워크 오류 또는 API 접근 오류가 발생했습니다.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        // 날짜 변경 시 fetch 호출
        fetchMealData(selectedDate);
    }, [selectedDate, fetchMealData]);

    const handleDateChange = (e) => {
        setSelectedDate(e.target.value);
    };

    return (
        <div className="p-4 sm:p-6 lg:p-8 space-y-6">
            <h1 className="text-3xl font-extrabold text-gray-800 flex items-center">🍚 급식 알리미</h1>

            {/* 날짜 선택 UI */}
            <div className="flex items-center space-x-3 bg-white p-4 rounded-xl shadow-md border border-blue-100">
                <label htmlFor="mealDate" className="text-lg font-semibold text-blue-700">날짜 선택:</label>
                <input
                    type="date"
                    id="mealDate"
                    value={selectedDate}
                    onChange={handleDateChange}
                    className="flex-grow p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                />
            </div>

            {/* 결과 표시 */}
            <div className="mt-6 bg-white p-6 rounded-xl shadow-lg min-h-[200px] flex flex-col justify-center items-center">
                {loading && (
                     <div className="flex flex-col items-center">
                        <Loader2 className="animate-spin text-blue-500 w-8 h-8 mb-3" />
                        <p className="text-blue-600">급식 정보를 빠르게 불러오는 중입니다...</p>
                    </div>
                )}
                
                {error && !loading && <p className="text-red-500 font-medium">{error}</p>}

                {mealData && mealData.length > 0 && !loading && (
                    <div className="w-full space-y-4">
                        <h2 className="text-2xl font-bold text-gray-800 text-center">{selectedDate} 급식</h2>
                        {mealData.map((meal, index) => (
                            <div key={index} className="border-t pt-3">
                                <p className="font-semibold text-blue-600 mb-1">{meal.time}</p>
                                <p className="whitespace-pre-wrap text-gray-700 text-sm leading-relaxed">{meal.menu}</p>
                            </div>
                        ))}
                    </div>
                )}
                
                {mealData && mealData.length === 0 && !loading && (
                    <p className="text-gray-500 text-lg">해당 날짜에는 급식 정보가 없습니다.</p>
                )}
            </div>
        </div>
    );
};


/**
 * 퀴즈 탭 (객관식 버튼 및 퀴즈 데이터 통합)
 */
const QuizTab = ({ 
    currentQuiz, 
    handleQuizAnswer, 
    quizRef, 
    handleGenerateNewQuiz, 
    isGenerating, 
    currentQuizIndex,
    correctCount, 
    incorrectCount,
    quizFeedback,
    selectedSubject, 
    setSelectedSubject, 
    filteredQuizzesCount 
}) => {
    
    const quizToDisplay = currentQuiz;
    const quizNumber = currentQuizIndex + 1;
    const totalQuizzes = filteredQuizzesCount;
    const isCompleted = currentQuizIndex >= filteredQuizzesCount;

    // 퀴즈 문제 텍스트를 HTML로 안전하게 표시하는 함수
    const formatQuizText = (text) => {
        if (!text) return "";
        return text.replace(/\\\\/g, '<br/>'); // 줄바꿈만 HTML로 변환
    };

    // 피드백 스타일 설정 (최종 수정됨)
    const getButtonClass = (optionText) => {
        if (!quizFeedback) {
            return "bg-gray-100 hover:bg-indigo-50"; // 피드백 없을 때 기본 스타일
        }
        
        const isCorrectOption = optionText.trim() === quizToDisplay.answer.trim();
        const isSelected = optionText.trim() === quizFeedback.selectedAnswer.trim();

        // --- Feedback Active ---
        
        // 1. 선택된 문항
        if (isSelected) {
            return quizFeedback.isCorrect ? "bg-green-100 border-green-500 border-2 opacity-100" // 정답 선택 (초록색)
                                         : "bg-red-100 border-red-500 border-2 opacity-100"; // 오답 선택 (빨간색)
        }
        
        // 2. 정답 문항 (오답 선택 시에만 하이라이트)
        // 오답을 선택했고, 현재 문항이 정답일 경우 
        if (!quizFeedback.isCorrect && isCorrectOption) {
            return "bg-green-100 border-green-500 border-2 opacity-100"; // 정답 초록색 하이라이트
        }
        
        // 3. 나머지 문항 (흐리게)
        return "bg-gray-100 opacity-50";
    };

    return (
        <div className="p-4 sm:p-6 lg:p-8 space-y-6" ref={quizRef}>
            <div className="flex justify-between items-center mb-4">
                <h1 className="text-3xl font-extrabold text-gray-800">📚 오늘의 퀴즈</h1>
                {/* 정답/오답 개수 표시 */}
                <div className="flex space-x-3 text-sm font-semibold">
                    <span className="text-green-600 flex items-center">
                        <CheckCircle className="w-4 h-4 mr-1" /> 정답: {correctCount}개
                    </span>
                    <span className="text-red-600 flex items-center">
                        <XCircle className="w-4 h-4 mr-1" /> 오답: {incorrectCount}개
                    </span>
                </div>
            </div>
            
            {/* 과목 선택 드롭다운 (추가됨) */}
            <div className="relative w-full max-w-xs mb-6">
                <select
                    value={selectedSubject}
                    onChange={(e) => setSelectedSubject(e.target.value)}
                    className="appearance-none w-full bg-white border border-gray-300 text-gray-700 py-3 px-4 pr-8 rounded-lg leading-tight focus:outline-none focus:bg-white focus:border-indigo-500 shadow-sm"
                >
                    <option value="All">전체 과목 ({filteredQuizzesCount}문항)</option>
                    <option value="수학">수학</option>
                    <option value="영어">영어</option>
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
                    <ChevronDown className="w-4 h-4" />
                </div>
            </div>

            
            {!isCompleted ? (
                <div className="bg-white p-6 rounded-xl shadow-lg border border-indigo-100">
                    <div className="flex justify-between items-center mb-3">
                        <p className="text-xs font-semibold text-indigo-500">
                            {quizToDisplay.subject} - {quizToDisplay.unit}
                        </p>
                        <p className="text-sm font-medium text-gray-500">Q. {quizNumber} / {totalQuizzes}</p>
                    </div>
                    
                    <h2 className="text-xl font-semibold text-gray-700 mb-6" dangerouslySetInnerHTML={{ __html: formatQuizText(quizToDisplay.text) }}></h2>
                    
                    {/* 객관식 옵션 버튼 */}
                    <div className="space-y-3">
                        {(quizToDisplay.options || []).map((optionText, index) => (
                            <button
                                key={index}
                                onClick={() => !quizFeedback && handleQuizAnswer(optionText)} // 피드백 중에는 비활성화
                                disabled={!!quizFeedback}
                                className={`w-full text-left font-medium py-3 px-4 rounded-lg transition duration-500 shadow-sm border flex items-center ${getButtonClass(optionText)}`}
                            >
                                <span className="font-bold w-6 text-indigo-600">{index + 1}.</span>
                                <span className="flex-1" dangerouslySetInnerHTML={{ __html: formatQuizText(optionText) }}></span>
                                
                                {/* 피드백 아이콘 */}
                                {quizFeedback && (
                                    <>
                                        {/* 선택된 옵션이 정답인 경우 (초록색 체크) */}
                                        {quizFeedback.isCorrect && quizFeedback.selectedAnswer.trim() === optionText.trim() && (
                                            <CheckCircle className="w-5 h-5 text-green-600 ml-2" />
                                        )}
                                        {/* 선택된 옵션이 오답인 경우 (빨간색 X) */}
                                        {!quizFeedback.isCorrect && quizFeedback.selectedAnswer.trim() === optionText.trim() && (
                                            <XCircle className="w-5 h-5 text-red-600 ml-2" />
                                        )}
                                        {/* 선택되지 않았지만 정답인 경우 (오답 선택 시만) - 흐린 체크 */}
                                        {!quizFeedback.isCorrect && optionText.trim() === quizToDisplay.answer.trim() && (
                                            <CheckCircle className="w-5 h-5 text-green-600 ml-2 opacity-50" />
                                        )}
                                    </>
                                )}
                            </button>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="p-10 text-center bg-white rounded-xl shadow-lg space-y-4">
                    <p className="text-gray-500 text-lg font-bold">🎉 {selectedSubject} 퀴즈 완료!</p>
                    <p className="text-gray-600 mb-4">총 {totalQuizzes}문항 중 정답 {correctCount}개, 오답 {incorrectCount}개입니다.</p>
                    <button
                        onClick={handleGenerateNewQuiz}
                        disabled={isGenerating}
                        className="w-full sm:w-auto bg-pink-500 text-white font-bold py-3 px-6 rounded-full hover:bg-pink-600 transition duration-150 shadow-lg flex items-center justify-center disabled:opacity-50"
                    >
                        {isGenerating ? (
                            <>
                                <Loader2 className="animate-spin mr-2 w-5 h-5" /> 준비 중...
                            </>
                        ) : (
                            <>
                                <Sparkles className="mr-2 w-5 h-5" /> 새로운 10문제 시작 (재출제)
                            </>
                        )}
                    </button>
                </div>
            )}
            
            {/* 학습 연속성 (Streak) 표시 */}
            <div className="flex justify-center mt-6">
                <div className="bg-yellow-100 text-yellow-800 p-3 rounded-full font-semibold shadow-inner flex items-center">
                    🔥 스트릭: <span className="text-2xl ml-2">3일</span>
                </div>
            </div>
        </div>
    );
};

/**
 * 오답 노트 탭
 */
const ErrorNoteTab = ({ user, incorrectNotes, quizRef }) => {
    const [explanation, setExplanation] = useState({}); // {noteId: "해설 텍스트"}
    const [loadingId, setLoadingId] = useState(null); // 로딩 중인 노트 ID
    
    // 퀴즈 문제 텍스트를 정제하여 표시하는 함수 (오답 노트용)
    const cleanNoteText = (text) => {
        // 오답 노트에서도 달러 표시나 불필요한 LaTeX 기호들을 제거
        if (!text) return "";
        return text.replace(/\$/g, '').replace(/\\/g, ''); 
    };

    const handleRemoveNote = async (noteId) => {
        if (!db || !user) return console.error("DB 또는 사용자 없음");
        try {
            const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'incorrectNotes', noteId);
            await deleteDoc(docRef);
            console.log("오답 노트 삭제 완료:", noteId);
        } catch (e) {
            console.error("오답 노트 삭제 중 오류:", e);
        }
    };
    
    // Gemini에게 해설 요청
    const handleRequestExplanation = async (note) => {
        setLoadingId(note.id);
        // 문의 텍스트에서 달러 표시를 제거하지 않고 Gemini에게 그대로 전달 (AI가 수식으로 인식하도록)
        const userQuery = `이 수학/국영수 문제에 대해 고등학생 수준에 맞춰 친절하고 단계적인 해설을 제공해 주세요. 문제: "${note.data.text}". 정답은 "${note.data.answer}"입니다.`;
        
        try {
            const result = await generateGeminiContent(userQuery);
            setExplanation(prev => ({ ...prev, [note.id]: result }));
        } catch (e) {
            setExplanation(prev => ({ ...prev, [note.id]: "해설 생성 중 오류가 발생했습니다." }));
        } finally {
            setLoadingId(null);
        }
    };

    return (
        <div className="p-4 sm:p-6 lg:p-8 space-y-6">
            <h1 className="text-3xl font-extrabold text-gray-800 flex items-center">📝 오답 노트</h1>
            <div ref={quizRef} className="space-y-4"> {/* quizRef를 그대로 사용 */}
                {incorrectNotes.length === 0 ? (
                    <div className="p-10 text-center bg-white rounded-xl shadow-lg">
                        <p className="text-gray-500">아직 틀린 문제가 없습니다. 퀴즈를 풀어보세요!</p>
                    </div>
                ) : (
                    incorrectNotes.map((note) => (
                        <div key={note.id} className="bg-white p-5 rounded-xl shadow-md border-l-4 border-red-500 flex flex-col justify-between items-start">
                            <div className="flex-grow w-full">
                                <p className="text-sm font-medium text-red-500">{note.data.subject} - {note.data.unit}</p>
                                {/* 오답 노트 텍스트도 정제 함수를 사용합니다. */}
                                <p className="text-gray-700 mt-1 font-semibold">{cleanNoteText(note.data.text)}</p>
                                
                                <div className="mt-3 flex space-x-2">
                                    <button 
                                        onClick={() => handleRequestExplanation(note)}
                                        disabled={loadingId === note.id}
                                        className="bg-indigo-100 text-indigo-700 text-sm font-medium py-2 px-4 rounded-full hover:bg-indigo-200 transition duration-150 disabled:opacity-50 flex items-center"
                                    >
                                        {loadingId === note.id ? <Loader2 className="animate-spin mr-1 w-4 h-4" /> : <Sparkles className="mr-1 w-4 h-4" />}
                                        해설 요청 (Gemini)
                                    </button>
                                    <button 
                                        onClick={() => handleRemoveNote(note.id)}
                                        className="bg-gray-200 text-gray-600 text-sm font-medium py-2 px-4 rounded-full hover:bg-gray-300 transition duration-150"
                                        title="삭제"
                                    >
                                        <X className="w-4 h-4 inline-block" /> 삭제
                                    </button>
                                </div>
                                
                                {/* 해설 표시 영역 */}
                                {explanation[note.id] && (
                                    <div className="mt-4 p-3 bg-green-50 rounded-lg border border-green-200">
                                        <p className="font-bold text-green-700 mb-1">AI 튜터 해설:</p>
                                        <p className="whitespace-pre-wrap text-sm text-gray-700">{explanation[note.id]}</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

/**
 * 스터디 그룹 탭 (실시간 타이머, 카테고리, DB 누적 수정됨)
 */
const StudyGroupTab = ({ user }) => {
    // 실시간 공부 기록 상태
    const [isStudying, setIsStudying] = useState(false);
    const [elapsedSeconds, setElapsedSeconds] = useState(0); 
    const [intervalId, setIntervalId] = useState(null); 
    
    // DB에서 가져온 상태
    const [dailyTotalMinutes, setDailyTotalMinutes] = useState(0); // 오늘 전체 누적 시간 (분 단위)
    const [subjectMinutes, setSubjectMinutes] = useState({}); // 오늘 과목별 누적 시간 (분 단위)

    // 과목 분류 상태
    const STUDY_SUBJECTS = ['선택 안함', '국어', '영어', '수학', '탐구', '기타'];
    const [selectedSubject, setSelectedSubject] = useState(STUDY_SUBJECTS[0]); 

    // 그룹 목록 상태 (기존 로직 유지)
    const [myGroups, setMyGroups] = useState([]);

    // 1. 그룹 목록 및 일일 누적 시간 구독
    useEffect(() => {
        if (!db || !user) return;
        const today = new Date().toISOString().slice(0, 10);
        const logRef = doc(db, 'artifacts', appId, 'users', user.uid, 'dailyStudyLog', today);

        // 그룹 목록 구독
        const q = query(collection(db, 'artifacts', appId, 'public', 'data', 'studyGroups'), where('members', 'array-contains', user.uid));
        const unsubscribeGroup = onSnapshot(q, (snapshot) => {
            const groups = snapshot.docs.map(doc => ({ id: doc.id, data: doc.data() }));
            setMyGroups(groups);
        }, (error) => {
            console.error("그룹 데이터 구독 오류:", error);
        });
        
        // 일일 누적 학습 시간 구독
        const unsubscribeLog = onSnapshot(logRef, (docSnap) => {
            if (docSnap.exists()) {
                // 분 단위로 저장된 값 불러오기
                setDailyTotalMinutes(docSnap.data().totalStudyMinutes || 0); 
                setSubjectMinutes(docSnap.data().subjectMinutes || {}); // 과목별 시간 불러오기
            } else {
                setDailyTotalMinutes(0);
                setSubjectMinutes({});
            }
        }, (error) => {
            console.error("일일 학습 로그 구독 오류:", error);
        });

        // 클린업 함수 반환
        return () => {
            unsubscribeGroup();
            unsubscribeLog();
        };
    }, [user]);

    // 2. 실시간 타이머 작동 로직
    useEffect(() => {
        if (isStudying) {
            const id = setInterval(() => {
                setElapsedSeconds(prev => prev + 1);
            }, 1000);
            setIntervalId(id);
        } else if (intervalId) {
            clearInterval(intervalId);
            setIntervalId(null);
        }
        
        return () => {
            if (intervalId) {
                clearInterval(intervalId);
            }
        };
    }, [isStudying]);

    // 공부 시작/종료 로직
    const handleStudyToggle = async () => {
        if (!isStudying) {
             // --- 공부 시작 ---
            if (selectedSubject === '선택 안함') {
                return alert("공부 시작 전에 과목을 선택해 주세요.");
            }
            setIsStudying(true);
            alert(`공부 시작! [${selectedSubject}] 과목이 초 단위로 측정됩니다.`);
            
        } else {
            // --- 공부 종료 ---
            const sessionSeconds = elapsedSeconds;
            const sessionMinutes = Math.ceil(sessionSeconds / 60); 
            
            setIsStudying(false); // 타이머 중지
            
            if (db && user && sessionMinutes > 0) {
                const today = new Date().toISOString().slice(0, 10);
                const logRef = doc(db, 'artifacts', appId, 'users', user.uid, 'dailyStudyLog', today);
                
                try {
                    // Firestore에 누적 합산 로직
                    const logSnap = await getDoc(logRef);
                    const data = logSnap.exists() ? logSnap.data() : { totalStudyMinutes: 0, subjectMinutes: {} };
                    
                    const currentTotal = data.totalStudyMinutes || 0;
                    const currentSubjectMinutes = data.subjectMinutes || {};
                    
                    // 선택된 과목에 시간 누적
                    const updatedSubjectMinutes = {
                        ...currentSubjectMinutes,
                        [selectedSubject]: (currentSubjectMinutes[selectedSubject] || 0) + sessionMinutes
                    };

                    await setDoc(logRef, {
                        userId: user.uid,
                        date: today,
                        totalStudyMinutes: currentTotal + sessionMinutes, // 전체 누적 합산
                        subjectMinutes: updatedSubjectMinutes, // 과목별 누적 합산
                        updatedAt: serverTimestamp()
                    }, { merge: true });
                    
                    alert(`공부 종료! [${selectedSubject}] ${formatTime(sessionSeconds)} (${sessionMinutes}분)이 오늘 기록에 추가되었습니다.`);
                } catch (e) {
                     console.error("공부 기록 저장 실패:", e);
                     alert("공부 기록 저장에 실패했습니다.");
                }
            } else if (sessionSeconds > 0) {
                 alert("공부 시간이 너무 짧아 (1분 미만) 기록되지 않았습니다.");
            }
            
            setElapsedSeconds(0); // 실시간 타이머 리셋
            setSelectedSubject(STUDY_SUBJECTS[0]); // 과목 초기화
        }
    };

    return (
        <div className="p-4 sm:p-6 lg:p-8 space-y-6">
            <h1 className="text-3xl font-extrabold text-gray-800 flex items-center">👥 스터디 그룹</h1>
            
            {/* 개인 학습 기록 섹션 (점선 제거) */}
            <div className="bg-white p-6 rounded-xl shadow-xl border border-gray-200">
                <h2 className="text-xl font-bold mb-4 text-gray-700 flex items-center justify-between">
                    개인 학습 타이머
                    <span className="text-sm font-normal text-gray-500">오늘 누적: {dailyTotalMinutes}분</span>
                </h2>
                
                {/* 과목 선택 드롭다운 */}
                <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-600 mb-1">학습 과목 선택</label>
                    <select
                        value={selectedSubject}
                        onChange={(e) => setSelectedSubject(e.target.value)}
                        disabled={isStudying}
                        className={`w-full p-3 border rounded-lg appearance-none transition duration-150 ${isStudying ? 'bg-gray-100 text-gray-500' : 'bg-white border-indigo-300 focus:border-indigo-500'}`}
                    >
                        {STUDY_SUBJECTS.map(subject => (
                            <option key={subject} value={subject}>{subject}</option>
                        ))}
                    </select>
                </div>
                
                {/* 실시간 타이머 표시 */}
                <div className={`text-5xl font-extrabold text-center py-4 transition duration-300 ${isStudying ? 'text-green-600 animate-pulse' : 'text-gray-500'}`}>
                    {formatTime(elapsedSeconds)}
                </div>

                {/* 시작/종료 버튼 */}
                <button
                    onClick={handleStudyToggle}
                    className={`mt-4 w-full px-6 py-3 rounded-full font-bold transition duration-300 shadow-lg flex items-center justify-center mx-auto ${
                        isStudying 
                        ? 'bg-red-500 hover:bg-red-600 text-white' 
                        : 'bg-green-500 hover:bg-green-600 text-white disabled:bg-gray-400'
                    }`}
                    disabled={!isStudying && selectedSubject === '선택 안함'}
                >
                    {isStudying ? <Square className="w-5 h-5 mr-2" /> : <Play className="w-5 h-5 mr-2" />}
                    {isStudying ? `공부 종료 (${selectedSubject})` : '공부 시작'}
                </button>
            </div>
            
            {/* 과목별 누적 시간 표시 */}
            <h2 className="text-2xl font-semibold text-gray-700 mt-6 flex items-center"><List className="w-5 h-5 mr-2 text-indigo-500" /> 과목별 오늘 학습 시간</h2>
            <div className="bg-white p-4 rounded-xl shadow-md space-y-2">
                {STUDY_SUBJECTS.filter(s => s !== '선택 안함' && (subjectMinutes[s] || 0) > 0).length === 0 ? (
                    <p className="text-gray-500 text-sm p-2">기록된 과목별 학습 시간이 없습니다.</p>
                ) : (
                    STUDY_SUBJECTS.filter(s => s !== '선택 안함' && (subjectMinutes[s] || 0) > 0).map(subject => (
                        <div key={subject} className="flex justify-between items-center text-gray-700 border-b border-gray-100 last:border-b-0 py-1.5">
                            <span className="font-medium text-sm text-indigo-700">{subject}</span>
                            <span className="font-extrabold text-base">{subjectMinutes[subject]}분</span>
                        </div>
                    ))
                )}
            </div>


            <h2 className="text-2xl font-semibold text-gray-700 mt-6">나의 그룹 목록 ({myGroups.length})</h2>
            <div className="space-y-3">
                {myGroups.length === 0 ? (
                    <p className="text-gray-500 p-4 bg-gray-100 rounded-lg">가입된 스터디 그룹이 없습니다. 새로운 그룹을 만들어 보세요!</p>
                ) : (
                    myGroups.map(group => (
                        <div key={group.id} className="bg-white p-4 rounded-xl shadow-md flex justify-between items-center">
                            <div className="font-semibold text-gray-800">{group.group_name}</div>
                            <span className="text-sm text-indigo-500">{group.members.length} 명</span>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

/**
 * 실시간 퀴즈 탭 (참여 코드 기반, 랭킹 포함)
 */
const LiveQuizTab = ({ user }) => {
    const [joinCode, setJoinCode] = useState('');
    const [sessionStatus, setSessionStatus] = useState('대기'); // 대기, 진행, 결과
    const [currentSession, setCurrentSession] = useState(null);
    const [ranking, setRanking] = useState([]);

    // DB에서 현재 세션 상태를 실시간 구독
    useEffect(() => {
        if (!db || !currentSession) return;
        const sessionRef = doc(db, 'artifacts', appId, 'public', 'data', 'quizSessions', currentSession.id);
        const unsubscribe = onSnapshot(sessionRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                setSessionStatus(data.status);
                // 랭킹은 퀴즈 진행 중에도 실시간으로 업데이트될 수 있음 (간소화)
                if (data.ranking) {
                    setRanking(data.ranking.sort((a, b) => b.score - a.score));
                }
                setCurrentSession({ id: docSnap.id, ...data });
            }
        });
        return () => unsubscribe();
    }, [currentSession]);

    // 퀴즈 호스트 로직 (초기화)
    const handleHostQuiz = async () => {
        if (!db || !user) return;
        // 6자리 랜덤 숫자 코드를 생성
        const newCode = Math.random().toString(36).substring(2, 8).toUpperCase(); 
        
        try {
            const newSessionRef = doc(collection(db, 'artifacts', appId, 'public', 'data', 'quizSessions'));

            await setDoc(newSessionRef, {
                join_code: newCode,
                host_id: user.uid,
                quiz_set_id: 'quizSet_math2_01', // 사용할 퀴즈 세트 ID 가정
                status: '대기',
                participants: [{ id: user.uid, nickname: user.displayName || '호스트' }],
                ranking: [{ uid: user.uid, score: 0 }],
                createdAt: serverTimestamp()
            });

            setCurrentSession({ id: newSessionRef.id, join_code: newCode, status: '대기', ranking: [{ uid: user.uid, score: 0 }] });
            alert(`퀴즈 방 생성! 코드: ${newCode}`);

        } catch (e) {
            console.error("퀴즈 방 생성 오류:", e);
        }
    };
    
    // 퀴즈 참가자 로직 (코드 입력)
    const handleJoinQuiz = async () => {
        if (!db || !user || !joinCode) return;
        try {
            // 코드로 세션 조회 (인덱스 필요할 수 있으나, 여기서는 쿼리 사용)
            const q = query(collection(db, 'artifacts', appId, 'public', 'data', 'quizSessions'), where('join_code', '==', joinCode));
            const querySnapshot = await getDocs(q);

            if (!querySnapshot.empty) {
                const sessionDoc = querySnapshot.docs[0];
                const sessionData = sessionDoc.data();
                
                // 세션에 참가자 추가
                await updateDoc(sessionDoc.ref, {
                    participants: arrayUnion({ id: user.uid, nickname: user.displayName || '참가자' }),
                    ranking: arrayUnion({ uid: user.uid, score: 0 }),
                });

                setCurrentSession({ id: sessionDoc.id, ...sessionData });
                alert(`퀴즈 방에 참가했습니다: ${joinCode}`);

            } else {
                alert("유효하지 않거나 종료된 참여 코드입니다.");
            }
        } catch (e) {
            console.error("퀴즈 방 참가 오류:", e);
        }
    };
    
    // 퀴즈 진행 화면
    if (currentSession) {
        return (
            <div className="p-4 sm:p-6 lg:p-8 space-y-6">
                <h1 className="text-3xl font-extrabold text-gray-800 flex items-center"><Zap className="mr-2" />실시간 퀴즈 ({currentSession.join_code})</h1>
                <div className="bg-white p-6 rounded-xl shadow-lg">
                    <p className={`text-center text-xl font-bold mb-4 ${sessionStatus === '대기' ? 'text-indigo-500' : sessionStatus === '진행' ? 'text-green-500' : 'text-red-500'}`}>
                        상태: {sessionStatus === '대기' ? '참가자 대기 중' : sessionStatus === '진행' ? '퀴즈 진행 중!' : '퀴즈 종료'}
                    </p>
                    
                    {user.uid === currentSession.host_id && (
                         <button 
                            className="w-full bg-green-500 text-white font-bold py-3 rounded-lg hover:bg-green-600 transition duration-150 mb-4"
                            onClick={() => updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'quizSessions', currentSession.id), { status: '진행' })}
                            disabled={sessionStatus !== '대기'}
                         >
                             퀴즈 시작 (호스트 전용)
                         </button>
                    )}

                    <h2 className="text-2xl font-bold mt-6 mb-3 border-b pb-2">🏆 실시간 랭킹</h2>
                    <div className="space-y-2">
                        {ranking.map((p, index) => (
                            <div key={p.uid} className={`flex justify-between items-center p-3 rounded-lg ${index < 3 ? 'bg-yellow-100 font-bold' : 'bg-gray-50'}`}>
                                <span className="text-lg w-10 text-center">{index + 1}위</span>
                                <span className="flex-grow">{p.nickname || p.uid}</span>
                                <span className="text-indigo-600 font-extrabold">{p.score}점</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }
    
    // 퀴즈 입장/호스트 화면
    return (
        <div className="p-4 sm:p-6 lg:p-8 space-y-6">
            <h1 className="text-3xl font-extrabold text-gray-800 flex items-center"><Zap className="mr-2" />실시간 퀴즈</h1>
            
            {/* 호스트 섹션 */}
            <div className="bg-indigo-50 p-6 rounded-xl shadow-lg border-2 border-indigo-200 text-center">
                <h2 className="text-2xl font-bold text-indigo-700 mb-3">방 만들기 (호스트)</h2>
                <button 
                    onClick={handleHostQuiz}
                    className="w-full bg-indigo-600 text-white font-bold py-3 rounded-lg hover:bg-indigo-700 transition duration-150 shadow-md"
                >
                    새 퀴즈 방 생성
                </button>
            </div>

            <div className="flex items-center justify-center text-gray-400 font-semibold">- 또는 -</div>

            {/* 참가 섹션 */}
            <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-100 space-y-4">
                <h2 className="text-2xl font-bold text-gray-700 mb-3">참여 코드 입력</h2>
                <input
                    type="text"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    placeholder="6자리 참여 코드 입력"
                    maxLength={6}
                    className="w-full p-3 border-2 border-gray-300 rounded-lg text-center text-xl tracking-wider focus:border-green-500 focus:ring-green-500 transition duration-150"
                />
                <button
                    onClick={handleJoinQuiz}
                    className="w-full bg-green-500 text-white font-bold py-3 rounded-lg hover:bg-green-600 transition duration-150 shadow-md disabled:opacity-50"
                    disabled={joinCode.length !== 6}
                >
                    퀴즈 참가
                </button>
            </div>
        </div>
    );
};

// 문의 탭을 별도 컴포넌트로 분리 (상단 헤더에서 접근)
const InquiryTab = ({ user }) => {
    const [inquiryText, setInquiryText] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    
    const handleSubmitInquiry = async () => {
        if (!inquiryText.trim()) return alert("문의 내용을 입력해 주세요.");
        if (!db || !user) return alert("사용자 인증 정보가 부족합니다.");

        setIsSubmitting(true);
        
        try {
            // 문의 내용을 Firestore의 공개 컬렉션에 저장합니다.
            const inquiryRef = collection(db, 'artifacts', appId, 'public', 'data', 'inquiries');
            
            await addDoc(inquiryRef, {
                userId: user.uid,
                userName: user.displayName || user.email || '익명 사용자',
                content: inquiryText,
                status: 'pending',
                submittedAt: serverTimestamp(),
            });

            alert("문의 내용이 성공적으로 접수되었습니다. 곧 답변드리겠습니다!");
            setInquiryText('');

        } catch (e) {
            console.error("문의 제출 실패:", e);
            alert("문의 제출 중 오류가 발생했습니다. 다시 시도해 주세요.");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="p-8 text-center min-h-[50vh] flex flex-col justify-center items-center">
            <HelpCircle className="mx-auto w-12 h-12 text-yellow-500 mb-4" />
            <h1 className="text-3xl font-bold text-gray-800">문의 및 피드백</h1>
            <p className="text-gray-600 mt-3 max-w-md">
                앱 사용 중 불편했던 점이나 새로운 기능에 대한 제안을 남겨주시면 개발에 적극 반영하겠습니다.
            </p>
            <div className="mt-6 w-full max-w-sm">
                <textarea
                    placeholder="여기에 문의 내용을 작성해주세요..."
                    rows="4"
                    value={inquiryText}
                    onChange={(e) => setInquiryText(e.target.value)}
                    disabled={isSubmitting}
                    className="w-full p-3 border-2 border-gray-300 rounded-lg focus:border-yellow-500 focus:ring-yellow-500 transition duration-150"
                ></textarea>
                <button
                    onClick={handleSubmitInquiry}
                    disabled={isSubmitting || inquiryText.trim().length === 0}
                    className="w-full mt-3 bg-yellow-500 text-white font-bold py-3 rounded-lg hover:bg-yellow-600 transition duration-150 shadow-md disabled:opacity-50 flex items-center justify-center"
                >
                    {isSubmitting ? (
                        <>
                            <Loader2 className="animate-spin mr-2 w-5 h-5" /> 제출 중...
                        </>
                    ) : (
                        "문의 제출"
                    )}
                </button>
            </div>
            
            <div className="mt-8 p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-sm max-w-md text-gray-700">
                **[개발자 알림]** 현재 문의 내용은 Firestore에 저장됩니다. 이메일 자동 발송을 위해서는 이후 Firebase Cloud Functions를 설정해야 합니다.
            </div>
        </div>
    );
};


/**
 * 메인 App 컴포넌트
 */
const App = ({ user, isAuthenticated }) => {
    // 퀴즈 탭이 중앙에 오도록 초기 탭을 'quiz'로 설정
    const [activeTab, setActiveTab] = useState('quiz');
    const [isModalOpen, setIsModalOpen] = useState(false);
    
    // --- 퀴즈 상태 관리 ---
    const [selectedSubject, setSelectedSubject] = useState('All'); // 'All', '수학', '영어'
    const [currentQuizIndex, setCurrentQuizIndex] = useState(0);
    const [correctCount, setCorrectCount] = useState(0);
    const [incorrectCount, setIncorrectCount] = useState(0);
    const [quizFeedback, setQuizFeedback] = useState(null); // { isCorrect: boolean, selectedAnswer: string }
    
    // 이전에 누락되었던 상태들을 여기에 추가합니다.
    const [modalImage, setModalImage] = useState(null);
    const [modalImageText, setModalImageText] = useState("");
    // ----------------------------------------------------
    
    // 오답노트 상태 및 세터 추가 (오류 해결)
    const [incorrectNotes, setIncorrectNotes] = useState([]);

    const quizRef = React.useRef(null); 

    const userId = user.uid;

    // --- 동적 퀴즈 데이터 생성 및 필터링 ---
    const [dynamicQuizData, setDynamicQuizData] = useState(() => {
        // 앱 최초 로딩 시 초기 데이터 생성
        const mathSet = generateMathQuiz().slice(0, 5);
        const engSet = generateEnglishQuiz().slice(0, 5);
        return [...mathSet, ...engSet].sort(() => Math.random() - 0.5);
    }); 
    
    // 퀴즈 데이터 필터링 (선택된 과목에 따라)
    const filteredQuizzes = useMemo(() => {
        // dynamicQuizData를 사용
        if (selectedSubject === 'All') return dynamicQuizData;
        return dynamicQuizData.filter(q => q.subject === selectedSubject);
    }, [selectedSubject, dynamicQuizData]);
    
    // 현재 퀴즈를 필터링된 목록에서 가져옴
    const currentQuiz = filteredQuizzes[currentQuizIndex];


    // --- 퀴즈 인덱스 초기화 및 동적 생성 useEffect: 필터 변경 시 ---
    useEffect(() => {
        // 과목이 바뀌면 퀴즈 인덱스/점수 리셋
        setCurrentQuizIndex(0);
        setCorrectCount(0);
        setIncorrectCount(0);
        setQuizFeedback(null);

        // 새로운 동적 퀴즈 세트 생성 (수학/영어/전체)
        if (selectedSubject === '수학') {
            setDynamicQuizData(generateMathQuiz());
        } else if (selectedSubject === '영어') {
            setDynamicQuizData(generateEnglishQuiz());
        } else {
            // 전체 과목일 경우, 수학/영어를 섞어 새 세트 생성 (총 20문제)
            const mathSet = generateMathQuiz().slice(0, 10);
            const engSet = generateEnglishQuiz().slice(0, 10);
            setDynamicQuizData([...mathSet, ...engSet].sort(() => Math.random() - 0.5));
        }
    }, [selectedSubject]);


    // --- Firestore 데이터 구독 (오답 노트) ---
    useEffect(() => {
        // [수정된 부분]: db와 userId가 유효할 때만 구독 실행하도록 안정성 강화
        if (!db || !userId) {
            console.log("Firestore 구독 건너뛰기: DB 또는 사용자 ID 없음");
            return;
        }
        
        const notesRef = collection(db, 'artifacts', appId, 'users', userId, 'incorrectNotes');
        const q = query(notesRef);

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const notes = snapshot.docs.map(doc => ({ id: doc.id, data: doc.data() }));
            setIncorrectNotes(notes);
        }, (error) => {
            console.error("오답 노트 데이터 구독 오류:", error);
            // 권한 오류가 발생하면 사용자에게 알림 (보안 규칙 문제)
            if (error.code === 'permission-denied') {
                 console.error("보안 규칙 오류: 오답 노트 읽기 권한이 없습니다. Firebase 보안 규칙을 확인하세요.");
            }
        });

        return () => unsubscribe(); 
    }, [userId]);
    
    // --- 새로운 퀴즈 생성 로직 (재시작으로 대체) ---
    const handleGenerateNewQuiz = useCallback(() => {
        // 필터링된 퀴즈 세트를 처음부터 다시 시작 (10문제 재출제 효과)
        if (selectedSubject === '수학') {
            setDynamicQuizData(generateMathQuiz());
        } else if (selectedSubject === '영어') {
            setDynamicQuizData(generateEnglishQuiz());
        } else {
            const mathSet = generateMathQuiz().slice(0, 10);
            const engSet = generateEnglishQuiz().slice(0, 10);
            setDynamicQuizData([...mathSet, ...engSet].sort(() => Math.random() - 0.5));
        }
        
        // 인덱스 및 점수 초기화
        setCurrentQuizIndex(0);
        setCorrectCount(0);
        setIncorrectCount(0);
        setQuizFeedback(null);

        alert(`[${selectedSubject === 'All' ? '전체 과목' : selectedSubject}] 퀴즈가 새로운 ${filteredQuizzes.length}문항으로 재시작됩니다!`);
    }, [selectedSubject, filteredQuizzes.length]);


    // --- 퀴즈 정답 처리 로직 (0.5초 피드백 후 다음 문제로 이동) ---
    const handleQuizAnswer = (selectedOptionText) => {
        const quizToGrade = currentQuiz;
        if (!quizToGrade) return;
        if (quizFeedback) return; 

        // 1. 정답 여부 확인
        const isCorrect = selectedOptionText.trim() === quizToGrade.answer.trim();
        
        // 2. 피드백 설정 (0.5초간 유지)
        setQuizFeedback({ isCorrect, selectedAnswer: selectedOptionText });

        // 3. 점수 업데이트
        if (isCorrect) {
            setCorrectCount(prev => prev + 1);
        } else {
            setIncorrectCount(prev => prev + 1);
            // 오답 노트에 기록
            saveToErrorNote(quizToGrade);
        }

        // 4. 다음 문제로 이동 (0.5초 후)
        setTimeout(() => {
            setQuizFeedback(null); // 피드백 해제
            
            // 정답 여부 무관, 다음 문제로 이동
            if (currentQuizIndex < filteredQuizzes.length) {
                setCurrentQuizIndex(prev => prev + 1);
            }
        }, 500); // 0.5초 후 다음 문제로
    };
    
    // --- 오답 노트 저장 로직 (간소화) ---
    const saveToErrorNote = async (quiz) => {
        if (!db || !userId) return;
        
        try {
            const notesCollectionRef = collection(db, 'artifacts', appId, 'users', userId, 'incorrectNotes');
            
            await addDoc(notesCollectionRef, {
                text: quiz.text,
                answer: quiz.answer,
                subject: quiz.subject,
                unit: quiz.unit,
                first_incorrect_at: serverTimestamp(),
                latest_incorrect_at: serverTimestamp(),
            });

            console.log("오답 노트에 기록 완료:", quiz.text);

        } catch (e) {
            console.error("오답 노트 저장 실패:", e);
            alert("오답 노트 저장에 실패했습니다.");
        }
    };

    // --- Gemini 모달 열기 로직 ---
    const handleOpenGeminiModal = () => {
        if (activeTab === 'quiz' || activeTab === 'errorNote') {
            const { base64, textPrompt } = captureQuizScreen(quizRef); 
            setModalImage(base64);
            setModalImageText(textPrompt);
        } else {
            setModalImage(null);
            setModalImageText("");
        }
        setIsModalOpen(true);
    };

    // --- 로그인/로그아웃 로직 ---
    const handleSignIn = async () => {
        if (!auth) return alert("Firebase 인증 서비스를 찾을 수 없습니다.");
        
        // Google 로그인 팝업 호출 (실제 환경에서는 팝업 차단 해제 필요)
        const provider = new GoogleAuthProvider();
        try {
            // 이 토큰이 설정되지 않은 상태로 실행될 경우, 익명 로그인 상태임
            if (auth.currentUser && auth.currentUser.isAnonymous) {
                // 익명 사용자를 Google 계정으로 연결 시도
                await signInWithPopup(auth, provider);
                alert("Google 계정으로 성공적으로 로그인되었습니다!");
            } else {
                // 이미 Google 계정으로 로그인되어 있다면 아무것도 하지 않음 (또는 토큰 갱신)
                alert(`이미 ${auth.currentUser.email || auth.currentUser.uid}로 로그인되어 있습니다.`);
            }

        } catch (error) {
            console.error("Google 로그인 실패:", error);
            // 팝업 차단 오류 메시지 처리
            if (error.code === 'auth/popup-blocked' || error.code === 'auth/cancelled-popup-request') {
                 alert("로그인 팝업이 차단되었습니다. 브라우저 설정에서 팝업 차단을 해제해 주세요.");
            } else if (error.code === 'auth/unauthorized-domain') {
                 // 최종 오류 메시지 확인
                 alert("Google 로그인 실패: 현재 도메인이 Google에 등록되지 않았거나 등록 정보가 부정확합니다.");
            } else {
                 alert("Google 로그인에 실패했습니다.");
            }
        }
    };

    const handleSignOut = async () => {
        if (!auth) return;
        try {
            // 로그아웃 후 다시 익명 로그인 상태로 전환 (세션 유지를 위해)
            await signOut(auth);
            await signInAnonymously(auth);
            alert("로그아웃되었습니다. (익명 세션으로 전환)");
        } catch (error) {
            console.error("로그아웃 실패:", error);
            alert("로그아웃에 실패했습니다.");
        }
    };

    // --- 탭 콘텐츠 렌더링 ---
    const renderContent = () => {
        switch (activeTab) {
            case 'quiz':
                return <QuizTab 
                    currentQuizIndex={currentQuizIndex}
                    currentQuiz={currentQuiz} 
                    handleQuizAnswer={handleQuizAnswer} 
                    quizRef={quizRef} 
                    handleGenerateNewQuiz={handleGenerateNewQuiz}
                    isGenerating={false} // 생성 로직 제거했으므로 false 고정
                    correctCount={correctCount} 
                    incorrectCount={incorrectCount} 
                    quizFeedback={quizFeedback} 
                    selectedSubject={selectedSubject}
                    setSelectedSubject={setSelectedSubject}
                    filteredQuizzesCount={filteredQuizzes.length}
                />;
            case 'meal':
                return <MealTab user={user} />;
            case 'liveQuiz':
                return <LiveQuizTab user={user} />;
            case 'errorNote':
                // setIncorrectNotes를 props로 전달할 필요가 없으므로 그대로 둡니다.
                return <ErrorNoteTab user={user} incorrectNotes={incorrectNotes} quizRef={quizRef} />;
            case 'studyGroup':
                return <StudyGroupTab user={user} />;
            case 'inquiry':
                return <InquiryTab user={user} />;
            default:
                return null;
        }
    };

    const isLoggedIn = user && !user.isAnonymous;
    const userName = user ? (user.displayName || user.email || `익명 사용자 (${userId.substring(0, 4)}...)`) : '인증 대기 중';


    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            
            {/* 상단 바 */}
            <header className="bg-white shadow-md p-4 flex justify-between items-center sticky top-0 z-10">
                <h1 className="text-2xl font-bold text-indigo-600">스터디 동반자</h1>
                <div className="flex items-center space-x-3 text-sm text-gray-600">
                    
                    {/* 문의 탭 버튼 */}
                    <button 
                        onClick={() => setActiveTab('inquiry')} 
                        className="p-2 rounded-full hover:bg-gray-100 transition duration-150"
                        title="문의 및 피드백"
                    >
                        <HelpCircle className="w-6 h-6 text-yellow-500" />
                    </button>
                    
                    {/* 로그인/사용자 정보 표시 영역 */}
                    <div className="flex items-center bg-gray-100 p-2 rounded-lg">
                        <User className="w-5 h-5 text-indigo-500 mr-2" />
                        <span className="font-semibold text-gray-700 max-w-[120px] truncate">{userName}</span>
                        
                        {isLoggedIn ? (
                            <button 
                                onClick={handleSignOut}
                                className="ml-3 text-sm text-red-500 hover:text-red-700 font-semibold transition duration-150 p-1"
                                title="로그아웃"
                            >
                                <LogOut className="w-5 h-6" />
                            </button>
                        ) : (
                            <button 
                                onClick={handleSignIn}
                                className="ml-3 text-sm bg-indigo-500 text-white px-2 py-1 rounded hover:bg-indigo-600 font-semibold transition duration-150"
                                title="Google로 로그인"
                            >
                                로그인
                            </button>
                        )}
                    </div>
                </div>
            </header>

            {/* 메인 콘텐츠 */}
            <main className="flex-grow pb-20">
                {renderContent()}
            </main>
            
            {/* Gemini 플로팅 버튼 */}
            {(activeTab === 'quiz' || activeTab === 'errorNote') && (
                <button
                    onClick={() => {
                        // 모달이 열리기 전에 캡처 로직 실행
                        if (activeTab === 'quiz' || activeTab === 'errorNote') {
                            const { base64, textPrompt } = captureQuizScreen(quizRef);
                            setModalImage(base64);
                            setModalImageText(textPrompt);
                        } else {
                            setModalImage(null);
                            setModalImageText("");
                        }
                        setIsModalOpen(true);
                    }}
                    className="fixed bottom-20 right-5 bg-pink-500 text-white p-4 rounded-full shadow-2xl hover:bg-pink-600 transition duration-300 z-40 transform hover:scale-105"
                    title="AI 튜터에게 질문하기"
                >
                    <Bot className="w-6 h-6" />
                </button>
            )}

            {/* 하단 내비게이션 바 */}
            <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-xl z-30">
                <div className="flex justify-around max-w-lg mx-auto">
                    {navItems.map((item) => {
                        const Icon = item.icon;
                        const isActive = activeTab === item.id;
                        return (
                            <button
                                key={item.id}
                                onClick={() => setActiveTab(item.id)}
                                // 중앙 탭(퀴즈)에 시각적 강조 추가
                                className={`flex flex-col items-center p-3 text-xs font-medium transition duration-200 sm:text-sm ${
                                    isActive 
                                        ? 'text-indigo-600 border-t-2 border-indigo-600 pt-2' 
                                        : 'text-gray-500 hover:text-indigo-400'
                                } ${item.id === 'quiz' ? 'bg-indigo-50/50 rounded-t-lg' : ''}`}
                            >
                                <Icon className="w-6 h-6 mb-1" />
                                <span>{item.label}</span>
                            </button>
                        );
                    })}
                </div>
            </nav>
            
            {/* Gemini 채팅 모달 */}
            <GeminiChatModal 
                isOpen={isModalOpen} 
                onClose={() => setIsModalOpen(false)} 
                initialImageBase64={modalImage}
                initialImageText={modalImageText}
            />
        </div>
    );
};

// 메인 렌더링
const LearningCompanion = () => (
    <div className="font-sans antialiased">
        <style>{`
            /* Inter 폰트 적용 (Tailwind 기본 설정에 포함) */
            body { font-family: 'Inter', sans-serif; }
            /* 모바일 환경에서 하단 바 때문에 콘텐츠가 가려지는 것을 방지 */
            .pb-20 { padding-bottom: 5rem; } 
        `}</style>
        <AuthAndDBSetup />
    </div>
);

export default LearningCompanion;
