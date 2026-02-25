document.addEventListener("DOMContentLoaded", function () {
  var searchInput = document.getElementById("notesSearch");
  var notesGrid = document.getElementById("notesGrid");
  var noResults = document.getElementById("noResults");
  var cards = document.querySelectorAll(".note-card");

  if (searchInput && notesGrid) {
    searchInput.addEventListener("input", function () {
      var searchTerm = this.value.toLowerCase().trim();
      var visibleCount = 0;

      cards.forEach(function (card) {
        var filename = card.dataset.filename.toLowerCase();
        var preview = card.dataset.preview.toLowerCase();

        if (
          searchTerm === "" ||
          filename.includes(searchTerm) ||
          preview.includes(searchTerm)
        ) {
          card.style.display = "";
          visibleCount++;
        } else {
          card.style.display = "none";
        }
      });

      if (visibleCount === 0) {
        noResults.classList.remove("hidden");
      } else {
        noResults.classList.add("hidden");
      }
    });
  }
});
