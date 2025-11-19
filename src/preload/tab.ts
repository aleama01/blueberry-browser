import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";

/**
 * ⚠️  IMPORTANT: This preload script is NOT currently loaded or built
 * 
 * This file was originally intended as a preload script for tab WebContentsViews,
 * but is NOT included in electron.vite.config.ts build configuration.
 * 
 * For security reasons, the Tab class (src/main/Tab.ts) intentionally does NOT
 * configure a preload script when creating WebContentsView instances. This keeps
 * external websites fully sandboxed.
 * 
 * Instead, these utilities have been integrated directly into Tab.wrapScriptForExecution()
 * in src/main/Tab.ts. This approach:
 * - Maintains security by not exposing APIs to untrusted external websites
 * - Only provides utilities to user-approved scripts
 * - Avoids preload script complexity
 * 
 * 📚 This file serves as REFERENCE DOCUMENTATION for available utilities.
 * 
 * To add new utilities:
 * 1. Add the implementation to Tab.wrapScriptForExecution() in src/main/Tab.ts
 * 2. Document it in LLMClient.buildAgentSystemPrompt() so the AI knows about it
 * 3. Optionally update this file to keep the reference catalog current
 */

/**
 * DOM Utilities for safe element manipulation
 */
const domUtils = {
  /**
   * Safely query a single element
   */
  querySelector: (selector: string, context: Document | Element = document): Element | null => {
    try {
      return context.querySelector(selector);
    } catch (error) {
      console.error(`querySelector failed for "${selector}":`, error);
      return null;
    }
  },

  /**
   * Safely query all elements
   */
  querySelectorAll: (selector: string, context: Document | Element = document): Element[] => {
    try {
      return Array.from(context.querySelectorAll(selector));
    } catch (error) {
      console.error(`querySelectorAll failed for "${selector}":`, error);
      return [];
    }
  },

  /**
   * Find element by text content
   */
  findByText: (text: string, tag: string = '*', exact: boolean = false): Element | null => {
    const elements = Array.from(document.querySelectorAll(tag));
    return elements.find(el => {
      const content = el.textContent?.trim() || '';
      return exact ? content === text : content.includes(text);
    }) || null;
  },

  /**
   * Wait for element to appear in DOM
   */
  waitForElement: (
    selector: string,
    timeout: number = 10000
  ): Promise<Element | null> => {
    return new Promise((resolve) => {
      const element = document.querySelector(selector);
      if (element) {
        resolve(element);
        return;
      }

      const observer = new MutationObserver(() => {
        const element = document.querySelector(selector);
        if (element) {
          observer.disconnect();
          resolve(element);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });

      setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  },

  /**
   * Check if element is visible
   */
  isVisible: (element: Element): boolean => {
    if (!(element instanceof HTMLElement)) return false;
    
    const style = window.getComputedStyle(element);
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      element.offsetParent !== null
    );
  },

  /**
   * Scroll element into view smoothly
   */
  scrollIntoView: (element: Element, behavior: ScrollBehavior = 'smooth'): void => {
    element.scrollIntoView({ behavior, block: 'center' });
  },
};

/**
 * Form Utilities for input manipulation
 */
const formUtils = {
  /**
   * Set input value and trigger events (React/Vue compatible)
   */
  setInputValue: (input: HTMLInputElement | HTMLTextAreaElement, value: string): void => {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(input, value);
    } else {
      input.value = value;
    }

    // Dispatch events for framework compatibility
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  },

  /**
   * Set select/dropdown value
   */
  setSelectValue: (select: HTMLSelectElement, value: string): void => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  },

  /**
   * Set checkbox state
   */
  setCheckbox: (checkbox: HTMLInputElement, checked: boolean): void => {
    if (checkbox.checked !== checked) {
      checkbox.click();
    }
  },

  /**
   * Set radio button
   */
  setRadio: (radio: HTMLInputElement): void => {
    if (!radio.checked) {
      radio.click();
    }
  },

  /**
   * Fill form with data object
   */
  fillForm: (formData: Record<string, any>, formSelector?: string): number => {
    let filledCount = 0;
    const form = formSelector ? document.querySelector(formSelector) : document;
    if (!form) return 0;

    for (const [name, value] of Object.entries(formData)) {
      // Try by name attribute
      let input = form.querySelector(`[name="${name}"]`) as HTMLInputElement;
      
      // Try by id
      if (!input) {
        input = form.querySelector(`#${name}`) as HTMLInputElement;
      }

      if (!input) continue;

      try {
        if (input.type === 'checkbox') {
          formUtils.setCheckbox(input, Boolean(value));
        } else if (input.type === 'radio') {
          if (input.value === value) {
            formUtils.setRadio(input);
          }
        } else if (input.tagName === 'SELECT') {
          const selectEl = input as unknown as HTMLSelectElement;
          formUtils.setSelectValue(selectEl, String(value));
        } else if (input.tagName === 'INPUT' || input.tagName === 'TEXTAREA') {
          formUtils.setInputValue(input, String(value));
        }
        filledCount++;
      } catch (error) {
        console.error(`Failed to fill field "${name}":`, error);
      }
    }

    return filledCount;
  },

  /**
   * Get form data as object
   */
  getFormData: (formSelector: string): Record<string, any> => {
    const form = document.querySelector(formSelector);
    if (!form) return {};

    const data: Record<string, any> = {};
    const inputs = form.querySelectorAll('input, select, textarea');

    inputs.forEach((input) => {
      const htmlInput = input as HTMLInputElement;
      const name = htmlInput.name || htmlInput.id;
      if (!name) return;

      if (htmlInput.type === 'checkbox') {
        data[name] = htmlInput.checked;
      } else if (htmlInput.type === 'radio') {
        if (htmlInput.checked) {
          data[name] = htmlInput.value;
        }
      } else {
        data[name] = htmlInput.value;
      }
    });

    return data;
  },

  /**
   * Submit form programmatically
   */
  submitForm: (formSelector: string): boolean => {
    const form = document.querySelector(formSelector) as HTMLFormElement;
    if (!form) return false;

    // Try to find and click submit button first (better for SPAs)
    const submitBtn = form.querySelector('[type="submit"]') as HTMLButtonElement;
    if (submitBtn) {
      submitBtn.click();
      return true;
    }

    // Fallback to form.submit()
    form.submit();
    return true;
  },
};

/**
 * Data Extraction Utilities
 */
const dataUtils = {
  /**
   * Extract table data
   */
  extractTable: (tableSelector: string): any[][] => {
    const table = document.querySelector(tableSelector);
    if (!table) return [];

    const rows = Array.from(table.querySelectorAll('tr'));
    return rows.map(row => {
      const cells = Array.from(row.querySelectorAll('td, th'));
      return cells.map(cell => cell.textContent?.trim() || '');
    });
  },

  /**
   * Extract list items
   */
  extractList: (listSelector: string): string[] => {
    const list = document.querySelector(listSelector);
    if (!list) return [];

    const items = Array.from(list.querySelectorAll('li'));
    return items.map(item => item.textContent?.trim() || '');
  },

  /**
   * Extract links
   */
  extractLinks: (containerSelector?: string): Array<{ text: string; href: string }> => {
    const container = containerSelector ? document.querySelector(containerSelector) : document;
    if (!container) return [];

    const links = Array.from(container.querySelectorAll('a'));
    return links.map(link => ({
      text: link.textContent?.trim() || '',
      href: link.href,
    }));
  },

  /**
   * Extract images
   */
  extractImages: (containerSelector?: string): Array<{ alt: string; src: string }> => {
    const container = containerSelector ? document.querySelector(containerSelector) : document;
    if (!container) return [];

    const images = Array.from(container.querySelectorAll('img'));
    return images.map(img => ({
      alt: img.alt || '',
      src: img.src,
    }));
  },

  /**
   * Extract structured data from elements
   */
  extractData: (
    itemSelector: string,
    schema: Record<string, string>
  ): any[] => {
    const items = Array.from(document.querySelectorAll(itemSelector));
    return items.map(item => {
      const data: Record<string, any> = {};
      for (const [key, selector] of Object.entries(schema)) {
        const element = item.querySelector(selector);
        data[key] = element?.textContent?.trim() || null;
      }
      return data;
    });
  },
};

/**
 * Style Utilities
 */
const styleUtils = {
  /**
   * Apply styles to element
   */
  applyStyles: (element: Element, styles: Record<string, string>): void => {
    if (!(element instanceof HTMLElement)) return;
    
    for (const [property, value] of Object.entries(styles)) {
      element.style.setProperty(property, value);
    }
  },

  /**
   * Apply styles to multiple elements
   */
  applyStylesToAll: (selector: string, styles: Record<string, string>): number => {
    const elements = Array.from(document.querySelectorAll(selector));
    elements.forEach(el => styleUtils.applyStyles(el, styles));
    return elements.length;
  },

  /**
   * Hide elements
   */
  hide: (selector: string): number => {
    return styleUtils.applyStylesToAll(selector, { display: 'none' });
  },

  /**
   * Show elements
   */
  show: (selector: string, displayValue: string = 'block'): number => {
    return styleUtils.applyStylesToAll(selector, { display: displayValue });
  },

  /**
   * Toggle visibility
   */
  toggle: (selector: string): void => {
    const elements = Array.from(document.querySelectorAll(selector));
    elements.forEach(el => {
      if (!(el instanceof HTMLElement)) return;
      el.style.display = el.style.display === 'none' ? '' : 'none';
    });
  },

  /**
   * Add class to elements
   */
  addClass: (selector: string, className: string): number => {
    const elements = Array.from(document.querySelectorAll(selector));
    elements.forEach(el => el.classList.add(className));
    return elements.length;
  },

  /**
   * Remove class from elements
   */
  removeClass: (selector: string, className: string): number => {
    const elements = Array.from(document.querySelectorAll(selector));
    elements.forEach(el => el.classList.remove(className));
    return elements.length;
  },
};

/**
 * Safe API exposed to tab content for script communication
 * This enables injected scripts to communicate with the main process
 */
const tabAPI = {
  // DOM Utilities
  dom: domUtils,
  
  // Form Utilities
  form: formUtils,
  
  // Data Extraction
  data: dataUtils,
  
  // Style Utilities  
  style: styleUtils,

  /**
   * Send a message to the main process
   */
  sendMessage: (channel: string, data: any) => {
    // Whitelist of allowed channels
    const allowedChannels = [
      'script-log',
      'script-progress',
      'script-result',
      'script-error',
    ];
    
    if (allowedChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },

  /**
   * Log from injected script
   */
  log: (...args: any[]) => {
    ipcRenderer.send('script-log', { args });
  },

  /**
   * Report progress from long-running script
   */
  reportProgress: (progress: number, message?: string) => {
    ipcRenderer.send('script-progress', { progress, message });
  },

  /**
   * Get tab information
   */
  getTabInfo: () => ipcRenderer.invoke('get-tab-info'),
};

// Expose safe API to renderer process
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("tabAPI", tabAPI);
  } catch (error) {
    console.error("Failed to expose tab API:", error);
  }
} else {
  // @ts-ignore
  window.electron = electronAPI;
  // @ts-ignore
  window.tabAPI = tabAPI;
}
