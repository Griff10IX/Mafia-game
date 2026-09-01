export const INSULTS = [
  "DICKHEAD",
  "KNOBHEAD",
  "MELT",
  "PLANK",
  "CLOWN",
  "MUPPET",
  "DOUGHNUT",
  "NUMPTY",
  "PILLLOCK",
  "PLONKER",
  "WALLY",
  "TWONK",
  "WET WIPE",
  "HELMET",
  "TOOL",
  "DIV",
  "BELLEND",
  "WINDOW LICKER",
  "ABSOLUTE UNIT OF A FOOL",
  "PROFESSIONAL IDIOT",
];

export const KICKED_LINES = [
  "System AI logged you out.",
  "You asked for it.",
  "That is not a prize.",
  "Come back when you can behave.",
  "The streets rejected you.",
  "Try again without the mouth.",
];

export const LOCKED_LINES = [
  "System AI locked you.",
  "You can look. You cannot play.",
  "Sit there until I get bored.",
  "This is not an investigation. This is a timeout.",
  "The city is still running. You are not.",
  "Ask nicely and I might still leave you here.",
];

export function pickInsultCopy(lines) {
  const insult = INSULTS[Math.floor(Math.random() * INSULTS.length)];
  const line = lines[Math.floor(Math.random() * lines.length)];
  return { insult, line };
}

export function pickKickedCopy() {
  return pickInsultCopy(KICKED_LINES);
}

export function pickLockedCopy() {
  return pickInsultCopy(LOCKED_LINES);
}
