import { initializeApp } from "firebase/app";
import { getFunctions } from "firebase/functions";

const firebaseConfig = {
  apiKey: "AIzaSyAYUlJFVfzwk4zZUbFlqpRSUoEBEdp9Img",
  authDomain: "elechub-gpt.firebaseapp.com",
  projectId: "elechub-gpt",
  storageBucket: "elechub-gpt.firebasestorage.app",
  messagingSenderId: "710401570525",
  appId: "1:710401570525:web:f47cab0b580d7769a5cd34"
};


export const app = initializeApp(firebaseConfig);
