export function setButtonLabel(
  button: HTMLButtonElement,
  label: string,
  options: { loading?: boolean } = {},
): void {
  const loading = options.loading === true;
  button.textContent = label;
  button.classList.toggle("button-loading", loading);
  if (loading) {
    button.setAttribute("aria-busy", "true");
    return;
  }
  button.removeAttribute("aria-busy");
}
