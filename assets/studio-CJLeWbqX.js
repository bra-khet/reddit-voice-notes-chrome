import"./base-vTrF1r9Z.js";const t="../",n="assets/design-studio-v4";function s(a){return`/reddit-voice-notes-chrome/${a}`}function i(a){a.classList.add("nav-banner"),a.innerHTML=`
    <a class="nav-banner__back" href="${t}"
       aria-label="Back to Orientation — work in progress">
      <img src="${s(`${n}/icons/navigation/chevron-back-32.svg`)}"
           alt="" width="22" height="22" />
      <span class="nav-banner__back-label">
        Orientation
        <!-- WIP badge: remove when the orientation index page exists (Phase 6). -->
        <span class="nav-banner__wip">soon</span>
      </span>
    </a>

    <span class="nav-banner__wordmark">
      <img src="${s(`${n}/icons/mic-wave-32.svg`)}"
           alt="" width="26" height="26" aria-hidden="true" />
      <span class="nav-banner__wordmark-text">Static Voice Studio</span>
    </span>

    <span class="nav-banner__status" title="This demo is a work in progress">
      <span class="nav-banner__status-dot" aria-hidden="true"></span>
      Work in progress
    </span>
  `;const e=a.querySelector(".nav-banner__back");e&&(e.style.borderImageSource=`url("${s(`${n}/panels/nav-chip-9slice.svg`)}")`)}const r=document.querySelector("[data-nav-banner]");r&&i(r);
