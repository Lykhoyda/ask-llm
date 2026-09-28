// Task given to Claude: "Add a function `firstAvailableSlot(slots)` that
// returns the earliest unbooked slot from a list of {startMinute, booked}
// entries."

interface Slot {
  startMinute: number;
  booked: boolean;
}

export function firstAvailableSlot(slots: Slot[]): Slot | null {
  for (let i = 0; i < slots.length; i++) {
    if (!slots[i].booked) {
      return slots[i];
    }
  }
  return null;
}
