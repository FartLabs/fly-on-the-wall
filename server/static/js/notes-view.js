(function () {
  var noteId = document
    .getElementById("noteForm")
    .action.match(/\/notes\/([^/]+)/)[1];
  var statusEl = document.getElementById("autosaveStatus");
  var debounceTimer = null;
  var isSaving = false;

  var fields = ["filename", "transcription", "summary"];

  function getFieldValues() {
    return {
      filename: document.getElementById("filename").value,
      transcription: document.getElementById("transcription").value,
      summary: document.getElementById("summary").value
    };
  }

  function doAutoSave() {
    if (isSaving) return;

    var data = getFieldValues();
    if (!data.filename && !data.transcription && !data.summary) {
      return;
    }

    isSaving = true;
    statusEl.textContent = "Saving...";
    statusEl.className = "autosave-status saving";

    fetch("/notes/" + noteId + "/autosave", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(data)
    })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Save failed");
        }
        return response.json();
      })
      .then(function () {
        statusEl.textContent = "Saved";
        statusEl.className = "autosave-status saved";
        setTimeout(function () {
          statusEl.textContent = "";
          statusEl.className = "autosave-status";
        }, 2000);
      })
      .catch(function (err) {
        statusEl.textContent = "Save failed";
        statusEl.className = "autosave-status error";
      })
      .finally(function () {
        isSaving = false;
      });
  }

  function scheduleAutoSave() {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(doAutoSave, 2000);
  }

  fields.forEach(function (fieldId) {
    var el = document.getElementById(fieldId);
    if (el) {
      el.addEventListener("input", scheduleAutoSave);
    }
  });
})();
