# Client Talk2Mates (Tauri + React)

Dossier à initialiser avec :

```bash
npm create tauri-app@latest . -- --template react-ts
npm install livekit-client
```

Prérequis Windows : [Node.js LTS](https://nodejs.org), [Rust](https://rustup.rs), et les « Microsoft C++ Build Tools » (voir https://tauri.app/start/prerequisites/).

Premier objectif (V0.1) : un écran pseudo + code d'invitation → `POST /token` sur l'API → connexion au salon avec `livekit-client`.
