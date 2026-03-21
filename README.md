# Eye Tracking PDF Viewer

## 프로젝트 소개
시선 추적을 기반으로 PDF 문서를 읽을 때 자동으로 페이지를 넘겨주는 웹 애플리케이션

## 목표
- MVP 완료: 2026년 4월 28일
- 웹 기반 시선 추적 구현
- PDF 자동 페이지 넘김 기능 개발

## 기술 스택
- React
- MediaPipe FaceMesh
- PDF.js
- Vite

## 주요 기능
- 시선 추적 (Eye Tracking)
- PDF 문서 렌더링
- 시선 기반 페이지 자동 전환
- 시선 데이터 로깅 (논문 대비)

## 아키텍처
- eyeTracking
- pdfViewer
- pagePrediction
- dataLogger

## 프로젝트 구조
src/
 ├ modules/
 │   ├ eyeTracking/
 │   ├ pdfViewer/
 │   ├ pagePrediction/
 │   └ dataLogger/
 │
 ├ controllers/
 │   └ mainController/
 │
 ├ services/
 └ utils/

## 실행 방법
npm install
npm run dev

## 향후 계획
- 시선 정확도 개선 (calibration, smoothing)
- Android 앱 확장 (Capacitor)
- 읽기 패턴 분석 및 예측 기능 추가
- 논문 작성 및 데이터 분석

## 참고
- MediaPipe FaceMesh 기반 시선 추정
- PDF.js 기반 문서 렌더링