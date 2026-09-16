import { electronAPI } from '../../preload/index';

declare global {
  interface Window {
    electronAPI: typeof electronAPI;
  }
}
