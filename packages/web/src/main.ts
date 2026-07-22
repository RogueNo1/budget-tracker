import './style.css';
import { mountApp } from './ui.js';

const root = document.querySelector<HTMLDivElement>('#app');
if (root) {
  mountApp(root);
} else {
  console.error('Budget Tracker: #app root element not found.');
}
