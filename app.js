(function () {
  "use strict";

  const form = document.getElementById("form");
  const btn = document.getElementById("btn");
  const csInput = document.getElementById("cs");
  const toggleCs = document.getElementById("toggleCs");

  const overlay = document.getElementById("overlay");
  const modal = document.getElementById("modal");
  const modalBadge = document.getElementById("modalBadge");
  const modalTitle = document.getElementById("modalTitle");
  const modalText = document.getElementById("modalText");
  const modalDetail = document.getElementById("modalDetail");
  const modalClose = document.getElementById("modalClose");

  function showModal(opts) {
    modal.className = "modal " + (opts.ok ? "ok" : "err");
    modalBadge.textContent = opts.ok ? "✔" : "✖";
    modalTitle.textContent = opts.title;
    modalText.textContent = opts.text;
    if (opts.detail) {
      modalDetail.classList.remove("hidden");
      modalDetail.textContent = opts.detail;
    } else {
      modalDetail.classList.add("hidden");
    }
    overlay.classList.add("show");
  }

  function hideModal() {
    overlay.classList.remove("show");
  }

  modalClose.addEventListener("click", hideModal);
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) hideModal();
  });

  toggleCs.addEventListener("click", function () {
    const showing = csInput.type === "text";
    csInput.type = showing ? "password" : "text";
    toggleCs.textContent = showing ? "Show" : "Hide";
  });

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    btn.disabled = true;
    btn.textContent = "Testing...";

    try {
      const res = await fetch("/api/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionString: csInput.value }),
      });
      const data = await res.json();

      if (data.ok) {
        const count = (data.objects && data.objects.length) || 0;
        let detail = data.version || "";
        detail += "\n\n" + count + " " + data.objectLabel + (count ? ":" : " found.");
        if (count) detail += "\n- " + data.objects.join("\n- ");
        showModal({
          ok: true,
          title: "Connected!",
          text: data.type + " · responded in " + data.latencyMs + " ms",
          detail: detail.trim(),
        });
      } else {
        const msg = (data.error && data.error.message) || "Could not connect.";
        showModal({
          ok: false,
          title: "Connection failed",
          text: msg,
          detail: data.error ? JSON.stringify(data.error, null, 2) : "",
        });
      }
    } catch (err) {
      showModal({
        ok: false,
        title: "Network error",
        text: "Could not reach the server. Please try again.",
        detail: err.message,
      });
    } finally {
      btn.disabled = false;
      btn.textContent = "Test connection";
    }
  });
})();
