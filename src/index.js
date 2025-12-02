import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App'; // <-- App.jsx에서 메인 컴포넌트를 가져옵니다.

// Create Root 및 렌더링
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App /> 
  </React.StrictMode>
);
