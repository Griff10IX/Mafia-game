/**
 * Profanity filter utility - replaces swear words with asterisks
 * Example: "fuck" -> "f***", "shit" -> "s***"
 */

const PROFANITY_LIST = [
  'fuck', 'fucking', 'fucked', 'fucker', 'fuckers', 'fucks', 'motherfucker', 'motherfucking',
  'shit', 'shitting', 'shitty', 'bullshit', 'horseshit',
  'ass', 'asses', 'asshole', 'assholes', 'dumbass', 'jackass', 'badass',
  'bitch', 'bitches', 'bitching', 'bitchy',
  'damn', 'damned', 'damnit', 'goddamn', 'goddamnit',
  'hell',
  'crap', 'crappy',
  'dick', 'dicks', 'dickhead', 'dickheads',
  'cock', 'cocks', 'cocksucker',
  'pussy', 'pussies',
  'cunt', 'cunts',
  'whore', 'whores',
  'slut', 'sluts', 'slutty',
  'bastard', 'bastards',
  'piss', 'pissed', 'pissing',
  'fag', 'fags', 'faggot', 'faggots',
  'nigger', 'niggers', 'nigga', 'niggas',
  'retard', 'retarded', 'retards',
  'twat', 'twats',
  'wanker', 'wankers',
  'bollocks',
  'arse', 'arsehole',
  'tosser', 'tossers',
  'bellend',
  'knob', 'knobhead',
  'prick', 'pricks',
];

/**
 * Censor a single word: keep first letter, replace rest with asterisks
 * @param {string} word - The word to censor
 * @returns {string} - Censored word (e.g., "fuck" -> "f***")
 */
function censorWord(word) {
  if (word.length <= 1) return '*';
  return word[0] + '*'.repeat(word.length - 1);
}

/**
 * Filter profanity from text - replaces swear words with asterisks
 * Preserves the original case pattern
 * @param {string} text - The text to filter
 * @returns {string} - Filtered text with profanity censored
 */
export function filterProfanity(text) {
  if (!text || typeof text !== 'string') return text;
  
  let result = text;
  
  for (const word of PROFANITY_LIST) {
    // Create regex that matches the word with word boundaries, case insensitive
    const regex = new RegExp(`\\b(${word})\\b`, 'gi');
    result = result.replace(regex, (match) => censorWord(match));
  }
  
  return result;
}

/**
 * Check if text contains any profanity
 * @param {string} text - The text to check
 * @returns {boolean} - True if profanity is found
 */
export function containsProfanity(text) {
  if (!text || typeof text !== 'string') return false;
  
  const lowerText = text.toLowerCase();
  for (const word of PROFANITY_LIST) {
    const regex = new RegExp(`\\b${word}\\b`, 'i');
    if (regex.test(lowerText)) return true;
  }
  
  return false;
}

export default filterProfanity;
