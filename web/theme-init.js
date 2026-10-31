(function initializeTheme() {
  try {
    var stored = window.localStorage.getItem("dev-agent-theme");
    document.documentElement.dataset.theme = stored === "dark" ? "dark" : "light";
  } catch (_error) {
    document.documentElement.dataset.theme = "light";
  }
})();
