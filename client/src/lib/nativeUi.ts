// Masque l'interface « Windows / navigateur » par défaut :
// - le menu du clic droit (Retour, Actualiser, Imprimer…) ;
// - les bulles blanches des attributs `title`, remplacées par une bulle aux couleurs de tomo.
// Les menus de clic droit propres à tomo (ex. dossiers de serveurs) continuent de marcher.

const DELAY = 450;

function isEditable(el: Element | null): boolean {
  if (!el) return false;
  const h = el as HTMLElement;
  return h.isContentEditable || el.tagName === "TEXTAREA" ||
    (el.tagName === "INPUT" && !["button", "checkbox", "radio", "range", "color", "file", "submit"].includes((el as HTMLInputElement).type));
}

let bubble: HTMLDivElement | null = null;
let timer = 0;
let current: HTMLElement | null = null;
let pointerX = -1;

function hide() {
  window.clearTimeout(timer);
  current = null;
  if (bubble) bubble.classList.remove("show");
}

function show(target: HTMLElement) {
  const text = target.dataset.tip;
  if (!text || !target.isConnected) return;
  if (!bubble) {
    bubble = document.createElement("div");
    bubble.className = "tip-bubble";
    bubble.setAttribute("role", "tooltip");
    document.body.appendChild(bubble);
  }
  bubble.textContent = text;
  bubble.style.left = "0px";
  bubble.style.top = "0px";
  bubble.classList.add("show");
  const r = target.getBoundingClientRect();
  const b = bubble.getBoundingClientRect();
  const gap = 8;
  // Colonne des serveurs (ou élément collé au bord gauche) : bulle à droite
  if (target.closest(".rail") || r.right < 70) {
    const top = Math.max(4, Math.min(r.top + r.height / 2 - b.height / 2, window.innerHeight - b.height - 4));
    bubble.style.left = `${Math.round(r.right + gap)}px`;
    bubble.style.top = `${Math.round(top)}px`;
    return;
  }
  let top = r.top - b.height - gap;
  if (top < 4) top = r.bottom + gap; // pas la place au-dessus → en dessous
  // Élément large (ex. tout l'en-tête d'une conversation) : la bulle suit la souris
  const anchor = r.width > 160 && pointerX >= r.left && pointerX <= r.right ? pointerX : r.left + r.width / 2;
  let left = anchor - b.width / 2;
  left = Math.max(6, Math.min(left, window.innerWidth - b.width - 6));
  bubble.style.left = `${Math.round(left)}px`;
  bubble.style.top = `${Math.round(top)}px`;
}

/** Transforme `title` en `data-tip` (la bulle native n'apparaît plus). */
function adopt(el: HTMLElement) {
  const title = el.getAttribute("title");
  if (title === null) return;
  el.removeAttribute("title");
  if (title) {
    el.dataset.tip = title;
    if (!el.hasAttribute("aria-label") && !el.textContent?.trim()) el.setAttribute("aria-label", title);
  }
}

export function installNativeUiGuards() {
  // Clic droit : pas de menu système, sauf dans les champs de texte (copier / coller).
  window.addEventListener("contextmenu", (e) => {
    if (isEditable(e.target as Element)) return;
    e.preventDefault();
  });

  document.addEventListener("pointermove", (e) => { pointerX = e.clientX; }, { passive: true });
  document.addEventListener("pointerover", (e) => {
    pointerX = e.clientX;
    const start = e.target as Element | null;
    if (!start || !(start instanceof Element)) return;
    // Retire tous les `title` sur le chemin (sinon un parent afficherait sa bulle native)
    for (let n: Element | null = start; n; n = n.parentElement) {
      if (n instanceof HTMLElement && n.hasAttribute("title")) adopt(n);
      if (n instanceof SVGElement) n.querySelector(":scope > title")?.remove();
    }
    const target = start.closest<HTMLElement>("[data-tip]");
    if (target === current) return;
    hide();
    if (!target) return;
    current = target;
    timer = window.setTimeout(() => current === target && show(target), DELAY);
  });
  document.addEventListener("pointerout", (e) => {
    if (current && !current.contains(e.relatedTarget as Node | null)) hide();
  });
  for (const ev of ["pointerdown", "wheel", "keydown", "blur"]) window.addEventListener(ev, hide, true);
  window.addEventListener("scroll", hide, true);
}
