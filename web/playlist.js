document.addEventListener("DOMContentLoaded", function() {
  const entries = document.querySelectorAll(".playlist-entry");
  const randomButton = document.querySelector("#random-button");

  for (var i = 0; i < entries.length; i++) {
    entries[i].addEventListener('touchstart', function() {
      this.classList.toggle('touched');
    });
    entries[i].addEventListener('touchend', function() {
      this.classList.toggle('touched');
    });
  }

  randomButton.addEventListener("click", function() {
    const randomIndex = Math.floor(Math.random() * entries.length);
    const selectedEntry = entries[randomIndex];

    entries.forEach(entry => {
      entry.classList.remove("selected");
    });
    selectedEntry.classList.add("selected");

    selectedEntry.scrollIntoView({ behavior: "smooth", block: "center" });
  });
});