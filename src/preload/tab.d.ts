import { ElectronAPI } from "@electron-toolkit/preload";

/**
 * DOM Utilities Interface
 */
interface DOMUtils {
  querySelector: (selector: string, context?: Document | Element) => Element | null;
  querySelectorAll: (selector: string, context?: Document | Element) => Element[];
  findByText: (text: string, tag?: string, exact?: boolean) => Element | null;
  waitForElement: (selector: string, timeout?: number) => Promise<Element | null>;
  isVisible: (element: Element) => boolean;
  scrollIntoView: (element: Element, behavior?: ScrollBehavior) => void;
}

/**
 * Form Utilities Interface
 */
interface FormUtils {
  setInputValue: (input: HTMLInputElement | HTMLTextAreaElement, value: string) => void;
  setSelectValue: (select: HTMLSelectElement, value: string) => void;
  setCheckbox: (checkbox: HTMLInputElement, checked: boolean) => void;
  setRadio: (radio: HTMLInputElement) => void;
  fillForm: (formData: Record<string, any>, formSelector?: string) => number;
  getFormData: (formSelector: string) => Record<string, any>;
  submitForm: (formSelector: string) => boolean;
}

/**
 * Data Extraction Utilities Interface
 */
interface DataUtils {
  extractTable: (tableSelector: string) => any[][];
  extractList: (listSelector: string) => string[];
  extractLinks: (containerSelector?: string) => Array<{ text: string; href: string }>;
  extractImages: (containerSelector?: string) => Array<{ alt: string; src: string }>;
  extractData: (itemSelector: string, schema: Record<string, string>) => any[];
}

/**
 * Style Utilities Interface
 */
interface StyleUtils {
  applyStyles: (element: Element, styles: Record<string, string>) => void;
  applyStylesToAll: (selector: string, styles: Record<string, string>) => number;
  hide: (selector: string) => number;
  show: (selector: string, displayValue?: string) => number;
  toggle: (selector: string) => void;
  addClass: (selector: string, className: string) => number;
  removeClass: (selector: string, className: string) => number;
}

/**
 * Tab API Interface
 */
interface TabAPI {
  // Utility namespaces
  dom: DOMUtils;
  form: FormUtils;
  data: DataUtils;
  style: StyleUtils;

  // Communication methods
  sendMessage: (channel: string, data: any) => void;
  log: (...args: any[]) => void;
  reportProgress: (progress: number, message?: string) => void;
  getTabInfo: () => Promise<any>;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    tabAPI: TabAPI;
  }
}

export { TabAPI, DOMUtils, FormUtils, DataUtils, StyleUtils };
