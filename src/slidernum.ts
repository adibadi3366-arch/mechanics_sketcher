// Every slider has a box beside it to type its value exactly: the slider goes
// in steps, and only over a set range.

/**
 * The box beside a slider to type its value exactly, with the unit after it.
 * `shown` is what the slider stands at, as text: a number, then whatever
 * follows it ("5 strokes", "0.8 pt"). `attr` names the box for whoever
 * handles what is typed in it.
 */
export function numberBox(attr: string, shown: string, label: string, off = false): string {
  const m = /^(-?[\d.]+)\s*(.*)$/.exec(shown.trim());
  const num = m ? m[1] : "", unit = m ? m[2] : shown;
  return `<span class="slider-num"><input ${attr} type="text" inputmode="decimal" value="${num}" aria-label="${label}, as a number"${off ? " disabled" : ""}>` +
    `<span class="unit">${unit.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)}</span></span>`;
}

/** Puts what a slider now stands at into the box beside it, unless that box is being typed in. */
export function showInBox(row: Element | null | undefined, shown: string): void {
  const box = row?.querySelector<HTMLInputElement>(".slider-num input");
  if (!box) return;
  const m = /^(-?[\d.]+)\s*(.*)$/.exec(shown.trim());
  if (document.activeElement !== box) box.value = m ? m[1] : "";
  const unit = row!.querySelector(".slider-num .unit");
  if (unit) unit.textContent = m ? m[2] : shown;
}
