(function () {
  const style = document.createElement("style");
  style.textContent = `
  .click-ripple {
    position: fixed;
    width: 14px; height: 14px;
    margin-left: -7px; margin-top: -7px;
    border-radius: 50%;
    pointer-events: none;
    opacity: 0.8;
    transform: scale(1);
    animation: ripple 520ms ease-out forwards;
    z-index: 9999;
    border: 2px solid currentColor;
  }
  @keyframes ripple {
    to { transform: scale(5.5); opacity: 0; }
  }`;
  document.head.appendChild(style);

  document.addEventListener("click", function (e) {
    const el = document.createElement("div");
    el.className = "click-ripple";
    el.style.left = e.clientX + "px";
    el.style.top = e.clientY + "px";

    document.body.appendChild(el);
    setTimeout(() => el.remove(), 600);
  }, { passive: true });
})();
