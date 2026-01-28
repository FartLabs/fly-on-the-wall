
import { elements } from "./domNodes";

export function setupSidebarListeners() {
  const { sidebar, sidebarTrigger } = elements;

  if (!sidebar || !sidebarTrigger) {
    console.error("Sidebar elements not found");
    return;
  }

  let closeTimeout: number | undefined;

  const openSidebar = () => {
    sidebar.classList.add("open");
    if (closeTimeout) {
      clearTimeout(closeTimeout);
      closeTimeout = undefined;
    }
  };

  const closeSidebar = () => {
    closeTimeout = window.setTimeout(() => {
      sidebar.classList.remove("open");
    }, 300); // Small delay to allow moving from trigger to sidebar
  };

  sidebarTrigger.addEventListener("mouseenter", openSidebar);
  sidebarTrigger.addEventListener("mouseleave", closeSidebar);
  sidebar.addEventListener("mouseenter", openSidebar);
  sidebar.addEventListener("mouseleave", closeSidebar);
  
  // Also close if we click outside (optional, but good UX)
  document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (
      !sidebar.contains(target) && 
      !sidebarTrigger.contains(target) && 
      sidebar.classList.contains("open")
    ) {
      sidebar.classList.remove("open");
    }
  });
}
