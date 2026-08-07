/**
 * 向 Chrome Extension 后台 Service Worker 发送消息并等待响应。
 * 统一包装 runtime.lastError 与业务级 response.ok 校验。
 *
 * @param {object} message 消息对象
 * @returns {Promise<any>} 响应数据
 */
export function sendExtensionMessage(message) {
  return new Promise((resolve, reject) => {
    if (!globalThis.chrome?.runtime?.sendMessage) {
      reject(new Error("chrome.runtime.sendMessage is unavailable"));
      return;
    }

    globalThis.chrome.runtime.sendMessage(message, (response) => {
      const error = globalThis.chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      if (!response?.ok) {
        reject(new Error(response?.error || "未知错误"));
        return;
      }

      resolve(response.data);
    });
  });
}
