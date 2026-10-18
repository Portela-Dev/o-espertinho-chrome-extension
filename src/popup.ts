const version = document.querySelector('#version');

if (version) {
  version.textContent = chrome.runtime.getManifest().version;
}

export {};
