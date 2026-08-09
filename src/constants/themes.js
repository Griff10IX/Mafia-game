/**
 * Theme presets: colours and textures for the app.
 * Changing theme updates Rank Progress bar, panel headers, buttons, sidebar, and all accent UI.
 */

import {
  EXPANDED_THEME_COLOURS,
  EXPANDED_THEME_TEXTURES,
  EXPANDED_THEME_FONTS,
  EXPANDED_THEME_WRITING_COLOURS,
  EXPANDED_QUICK_PRESETS,
  EXPANDED_FULL_PRESETS,
  EXPANDED_COLOUR_SECTION,
  EXPANDED_WRITING_SECTION,
  EXPANDED_PRESET_CATEGORIES,
} from './themes-expanded.js';

/** Hex colour presets: { id, name, primary, primaryBright, primaryDark, foregroundOnPrimary } */
export const THEME_COLOURS = [
  { id: 'gold', name: 'Gold', stops: ['#e8c84a', '#d4af37', '#b8860b'], primary: '#d4af37', primaryBright: '#e8c84a', primaryDark: '#a67c0a', foregroundOnPrimary: '#ffffff' },
  /* Button default: solid dark olive fill, bright gold border, gold-to-orange gradient text (Assign reference) */
  { id: 'dark-gold', name: 'Dark Gold', stops: ['#6e6234', '#61562C', '#4a4522'], primary: '#61562C', primaryBright: '#E0BC58', primaryDark: '#3f3a1c', foregroundOnPrimary: '#F2D070', foregroundShadow: '#A87C38' },
  { id: 'amber', name: 'Amber', primary: '#f59e0b', primaryBright: '#fbbf24', primaryDark: '#d97706', foregroundOnPrimary: '#000000' },
  { id: 'yellow', name: 'Yellow', primary: '#eab308', primaryBright: '#facc15', primaryDark: '#ca8a04', foregroundOnPrimary: '#000000' },
  { id: 'orange', name: 'Orange', primary: '#ea580c', primaryBright: '#f97316', primaryDark: '#c2410c', foregroundOnPrimary: '#ffffff' },
  { id: 'red', name: 'Red', primary: '#dc2626', primaryBright: '#ef4444', primaryDark: '#b91c1c', foregroundOnPrimary: '#ffffff' },
  { id: 'rose', name: 'Rose', primary: '#e11d48', primaryBright: '#f43f5e', primaryDark: '#be123c', foregroundOnPrimary: '#ffffff' },
  { id: 'crimson', name: 'Crimson', primary: '#be185d', primaryBright: '#ec4899', primaryDark: '#9d174d', foregroundOnPrimary: '#ffffff' },
  { id: 'fuchsia', name: 'Fuchsia', primary: '#c026d3', primaryBright: '#d946ef', primaryDark: '#a21caf', foregroundOnPrimary: '#ffffff' },
  { id: 'violet', name: 'Violet', primary: '#7c3aed', primaryBright: '#8b5cf6', primaryDark: '#6d28d9', foregroundOnPrimary: '#ffffff' },
  { id: 'purple', name: 'Purple', primary: '#9333ea', primaryBright: '#a855f7', primaryDark: '#7e22ce', foregroundOnPrimary: '#ffffff' },
  { id: 'indigo', name: 'Indigo', primary: '#4f46e5', primaryBright: '#6366f1', primaryDark: '#4338ca', foregroundOnPrimary: '#ffffff' },
  { id: 'blue', name: 'Blue', primary: '#2563eb', primaryBright: '#3b82f6', primaryDark: '#1d4ed8', foregroundOnPrimary: '#ffffff' },
  { id: 'sky', name: 'Sky', primary: '#0ea5e9', primaryBright: '#38bdf8', primaryDark: '#0284c7', foregroundOnPrimary: '#000000' },
  { id: 'cyan', name: 'Cyan', primary: '#0891b2', primaryBright: '#22d3ee', primaryDark: '#0e7490', foregroundOnPrimary: '#000000' },
  { id: 'teal', name: 'Teal', primary: '#0d9488', primaryBright: '#2dd4bf', primaryDark: '#0f766e', foregroundOnPrimary: '#ffffff' },
  { id: 'emerald', name: 'Emerald', primary: '#059669', primaryBright: '#10b981', primaryDark: '#047857', foregroundOnPrimary: '#ffffff' },
  { id: 'green', name: 'Green', primary: '#16a34a', primaryBright: '#22c55e', primaryDark: '#15803d', foregroundOnPrimary: '#ffffff' },
  { id: 'lime', name: 'Lime', primary: '#65a30d', primaryBright: '#84cc16', primaryDark: '#4d7c0f', foregroundOnPrimary: '#000000' },
  { id: 'olive', name: 'Olive', primary: '#84cc16', primaryBright: '#a3e635', primaryDark: '#65a30d', foregroundOnPrimary: '#000000' },
  { id: 'bronze', name: 'Bronze', primary: '#b45309', primaryBright: '#d97706', primaryDark: '#92400e', foregroundOnPrimary: '#ffffff' },
  { id: 'copper', name: 'Copper', primary: '#b45309', primaryBright: '#ea580c', primaryDark: '#9a3412', foregroundOnPrimary: '#ffffff' },
  { id: 'rust', name: 'Rust', primary: '#c2410c', primaryBright: '#ea580c', primaryDark: '#9a3412', foregroundOnPrimary: '#ffffff' },
  { id: 'wine', name: 'Wine', primary: '#9f1239', primaryBright: '#be123c', primaryDark: '#881337', foregroundOnPrimary: '#ffffff' },
  { id: 'plum', name: 'Plum', primary: '#701a75', primaryBright: '#86198f', primaryDark: '#581c87', foregroundOnPrimary: '#ffffff' },
  { id: 'slate', name: 'Slate', primary: '#475569', primaryBright: '#64748b', primaryDark: '#334155', foregroundOnPrimary: '#ffffff' },
  { id: 'zinc', name: 'Zinc', primary: '#71717a', primaryBright: '#a1a1aa', primaryDark: '#52525b', foregroundOnPrimary: '#ffffff' },
  { id: 'neutral', name: 'Neutral', primary: '#737373', primaryBright: '#a3a3a3', primaryDark: '#525252', foregroundOnPrimary: '#ffffff' },
  { id: 'stone', name: 'Stone', primary: '#78716c', primaryBright: '#a8a29e', primaryDark: '#57534e', foregroundOnPrimary: '#ffffff' },
  { id: 'mint', name: 'Mint', primary: '#10b981', primaryBright: '#34d399', primaryDark: '#059669', foregroundOnPrimary: '#000000' },
  { id: 'coral', name: 'Coral', primary: '#f43f5e', primaryBright: '#fb7185', primaryDark: '#e11d48', foregroundOnPrimary: '#ffffff' },
  { id: 'peach', name: 'Peach', primary: '#fb923c', primaryBright: '#fdba74', primaryDark: '#ea580c', foregroundOnPrimary: '#000000' },
  { id: 'honey', name: 'Honey', primary: '#eab308', primaryBright: '#fde047', primaryDark: '#ca8a04', foregroundOnPrimary: '#000000' },
  { id: 'mustard', name: 'Mustard', primary: '#ca8a04', primaryBright: '#eab308', primaryDark: '#a16207', foregroundOnPrimary: '#000000' },
  { id: 'saffron', name: 'Saffron', primary: '#f59e0b', primaryBright: '#fbbf24', primaryDark: '#d97706', foregroundOnPrimary: '#000000' },
  { id: 'burgundy', name: 'Burgundy', primary: '#881337', primaryBright: '#9f1239', primaryDark: '#701a75', foregroundOnPrimary: '#ffffff' },
  { id: 'maroon', name: 'Maroon', primary: '#9f1239', primaryBright: '#be123c', primaryDark: '#881337', foregroundOnPrimary: '#ffffff' },
  { id: 'magenta', name: 'Magenta', primary: '#c026d3', primaryBright: '#e879f9', primaryDark: '#a21caf', foregroundOnPrimary: '#ffffff' },
  { id: 'lavender', name: 'Lavender', primary: '#8b5cf6', primaryBright: '#a78bfa', primaryDark: '#7c3aed', foregroundOnPrimary: '#ffffff' },
  { id: 'periwinkle', name: 'Periwinkle', primary: '#6366f1', primaryBright: '#818cf8', primaryDark: '#4f46e5', foregroundOnPrimary: '#ffffff' },
  { id: 'navy', name: 'Navy', primary: '#1e40af', primaryBright: '#2563eb', primaryDark: '#1e3a8a', foregroundOnPrimary: '#ffffff' },
  { id: 'ocean', name: 'Ocean', primary: '#0369a1', primaryBright: '#0ea5e9', primaryDark: '#075985', foregroundOnPrimary: '#ffffff' },
  { id: 'aqua', name: 'Aqua', primary: '#06b6d4', primaryBright: '#22d3ee', primaryDark: '#0891b2', foregroundOnPrimary: '#000000' },
  { id: 'jade', name: 'Jade', primary: '#0d9488', primaryBright: '#14b8a6', primaryDark: '#0f766e', foregroundOnPrimary: '#ffffff' },
  { id: 'forest', name: 'Forest', primary: '#166534', primaryBright: '#22c55e', primaryDark: '#14532d', foregroundOnPrimary: '#ffffff' },
  { id: 'sage', name: 'Sage', primary: '#4d7c0f', primaryBright: '#65a30d', primaryDark: '#3f6212', foregroundOnPrimary: '#ffffff' },
  { id: 'chartreuse', name: 'Chartreuse', primary: '#65a30d', primaryBright: '#84cc16', primaryDark: '#4d7c0f', foregroundOnPrimary: '#000000' },
  { id: 'cream', name: 'Cream', primary: '#e7e5e4', primaryBright: '#f5f5f4', primaryDark: '#d6d3d1', foregroundOnPrimary: '#000000' },
  { id: 'ivory', name: 'Ivory', primary: '#fafaf9', primaryBright: '#ffffff', primaryDark: '#e7e5e4', foregroundOnPrimary: '#000000' },
  { id: 'silver', name: 'Silver', primary: '#a8a29e', primaryBright: '#d6d3d1', primaryDark: '#78716c', foregroundOnPrimary: '#000000' },
  { id: 'chrome', name: 'Chrome', primary: '#94a3b8', primaryBright: '#cbd5e1', primaryDark: '#64748b', foregroundOnPrimary: '#000000' },
  { id: 'steel', name: 'Steel', primary: '#64748b', primaryBright: '#94a3b8', primaryDark: '#475569', foregroundOnPrimary: '#ffffff' },
  { id: 'graphite', name: 'Graphite', primary: '#44403c', primaryBright: '#57534e', primaryDark: '#292524', foregroundOnPrimary: '#ffffff' },
  { id: 'charcoal', name: 'Charcoal', primary: '#3f3f46', primaryBright: '#52525b', primaryDark: '#27272a', foregroundOnPrimary: '#ffffff' },
  { id: 'midnight', name: 'Midnight', primary: '#312e81', primaryBright: '#4338ca', primaryDark: '#1e1b4b', foregroundOnPrimary: '#ffffff' },
  { id: 'twilight', name: 'Twilight', primary: '#4c1d95', primaryBright: '#6d28d9', primaryDark: '#3b0764', foregroundOnPrimary: '#ffffff' },
  { id: 'sunset', name: 'Sunset', primary: '#c2410c', primaryBright: '#ea580c', primaryDark: '#9a3412', foregroundOnPrimary: '#ffffff' },
  { id: 'sunrise', name: 'Sunrise', primary: '#ea580c', primaryBright: '#fb923c', primaryDark: '#c2410c', foregroundOnPrimary: '#000000' },
  { id: 'blood', name: 'Blood', primary: '#991b1b', primaryBright: '#b91c1c', primaryDark: '#7f1d1d', foregroundOnPrimary: '#ffffff' },
  { id: 'royal', name: 'Royal', primary: '#3730a3', primaryBright: '#4f46e5', primaryDark: '#312e81', foregroundOnPrimary: '#ffffff' },
  { id: 'electric', name: 'Electric', primary: '#2563eb', primaryBright: '#60a5fa', primaryDark: '#1d4ed8', foregroundOnPrimary: '#ffffff' },
  { id: 'neon-green', name: 'Neon Green', primary: '#22c55e', primaryBright: '#4ade80', primaryDark: '#16a34a', foregroundOnPrimary: '#000000' },
  { id: 'neon-pink', name: 'Neon Pink', primary: '#ec4899', primaryBright: '#f472b6', primaryDark: '#db2777', foregroundOnPrimary: '#000000' },
  { id: 'neon-blue', name: 'Neon Blue', primary: '#3b82f6', primaryBright: '#60a5fa', primaryDark: '#2563eb', foregroundOnPrimary: '#ffffff' },
  { id: 'neon-orange', name: 'Neon Orange', primary: '#f97316', primaryBright: '#fb923c', primaryDark: '#ea580c', foregroundOnPrimary: '#000000' },
  { id: 'pastel-pink', name: 'Pastel Pink', primary: '#f9a8d4', primaryBright: '#fbcfe8', primaryDark: '#ec4899', foregroundOnPrimary: '#000000' },
  { id: 'pastel-blue', name: 'Pastel Blue', primary: '#93c5fd', primaryBright: '#bfdbfe', primaryDark: '#3b82f6', foregroundOnPrimary: '#000000' },
  { id: 'pastel-green', name: 'Pastel Green', primary: '#86efac', primaryBright: '#bbf7d0', primaryDark: '#22c55e', foregroundOnPrimary: '#000000' },
  { id: 'pastel-purple', name: 'Pastel Purple', primary: '#c4b5fd', primaryBright: '#ddd6fe', primaryDark: '#8b5cf6', foregroundOnPrimary: '#000000' },
  { id: 'pastel-yellow', name: 'Pastel Yellow', primary: '#fde047', primaryBright: '#fef08a', primaryDark: '#eab308', foregroundOnPrimary: '#000000' },
  { id: 'deep-red', name: 'Deep Red', primary: '#7f1d1d', primaryBright: '#991b1b', primaryDark: '#450a0a', foregroundOnPrimary: '#ffffff' },
  { id: 'deep-blue', name: 'Deep Blue', primary: '#1e3a8a', primaryBright: '#1d4ed8', primaryDark: '#172554', foregroundOnPrimary: '#ffffff' },
  { id: 'deep-green', name: 'Deep Green', primary: '#14532d', primaryBright: '#166534', primaryDark: '#052e16', foregroundOnPrimary: '#ffffff' },
  { id: 'deep-purple', name: 'Deep Purple', primary: '#581c87', primaryBright: '#6d28d9', primaryDark: '#3b0764', foregroundOnPrimary: '#ffffff' },
  { id: 'pale-gold', name: 'Pale Gold', primary: '#fcd34d', primaryBright: '#fde68a', primaryDark: '#f59e0b', foregroundOnPrimary: '#000000' },
  { id: 'antique-brass', name: 'Antique Brass', primary: '#b8860b', primaryBright: '#d4af37', primaryDark: '#8b6914', foregroundOnPrimary: '#000000' },
  { id: 'gunmetal', name: 'Gunmetal', primary: '#2d3748', primaryBright: '#4a5568', primaryDark: '#1a202c', foregroundOnPrimary: '#ffffff' },
  { id: 'ash', name: 'Ash', primary: '#6b7280', primaryBright: '#9ca3af', primaryDark: '#4b5563', foregroundOnPrimary: '#ffffff' },
  { id: 'smoke', name: 'Smoke', primary: '#6b7280', primaryBright: '#9ca3af', primaryDark: '#4b5563', foregroundOnPrimary: '#ffffff' },
  { id: 'pewter', name: 'Pewter', primary: '#78716c', primaryBright: '#a8a29e', primaryDark: '#57534e', foregroundOnPrimary: '#ffffff' },
  { id: 'titanium', name: 'Titanium', primary: '#71717a', primaryBright: '#a1a1aa', primaryDark: '#52525b', foregroundOnPrimary: '#ffffff' },
  { id: 'carbon', name: 'Carbon', primary: '#3f3f46', primaryBright: '#52525b', primaryDark: '#27272a', foregroundOnPrimary: '#ffffff' },
  { id: 'obsidian', name: 'Obsidian', primary: '#27272a', primaryBright: '#3f3f46', primaryDark: '#18181b', foregroundOnPrimary: '#ffffff' },

  /* Mixed / blended colours */
  { id: 'rose-gold', name: 'Rose Gold', primary: '#b76e79', primaryBright: '#d4a0a8', primaryDark: '#9a5a64', foregroundOnPrimary: '#ffffff' },
  { id: 'copper-rose', name: 'Copper Rose', primary: '#996872', primaryBright: '#b8838c', primaryDark: '#7a5260', foregroundOnPrimary: '#ffffff' },
  { id: 'gold-amber', name: 'Gold Amber', primary: '#d4a574', primaryBright: '#e8c49a', primaryDark: '#b8864a', foregroundOnPrimary: '#000000' },
  { id: 'teal-blue', name: 'Teal Blue', primary: '#0d7a8c', primaryBright: '#1899ad', primaryDark: '#0a5c6b', foregroundOnPrimary: '#ffffff' },
  { id: 'violet-blue', name: 'Violet Blue', primary: '#5b4bb5', primaryBright: '#7260d4', primaryDark: '#453899', foregroundOnPrimary: '#ffffff' },
  { id: 'blue-teal', name: 'Blue Teal', primary: '#2a7b8a', primaryBright: '#3596a6', primaryDark: '#1f5d6a', foregroundOnPrimary: '#ffffff' },
  { id: 'sunset-blend', name: 'Sunset Blend', primary: '#d4694a', primaryBright: '#e88a6e', primaryDark: '#a84f34', foregroundOnPrimary: '#ffffff' },
  { id: 'forest-teal', name: 'Forest Teal', primary: '#1a6b5c', primaryBright: '#228b79', primaryDark: '#124d42', foregroundOnPrimary: '#ffffff' },
  { id: 'lavender-rose', name: 'Lavender Rose', primary: '#b87ba8', primaryBright: '#d19bc4', primaryDark: '#8f5d82', foregroundOnPrimary: '#ffffff' },
  { id: 'peach-gold', name: 'Peach Gold', primary: '#e5a86a', primaryBright: '#f0c08e', primaryDark: '#c48348', foregroundOnPrimary: '#000000' },
  { id: 'coral-pink', name: 'Coral Pink', primary: '#e85d6e', primaryBright: '#f07d8c', primaryDark: '#c94a5a', foregroundOnPrimary: '#ffffff' },
  { id: 'mint-blue', name: 'Mint Blue', primary: '#3db5a0', primaryBright: '#5ac9b5', primaryDark: '#2d8f7e', foregroundOnPrimary: '#000000' },
  { id: 'plum-violet', name: 'Plum Violet', primary: '#7e4d8e', primaryBright: '#9664a8', primaryDark: '#623a70', foregroundOnPrimary: '#ffffff' },
  { id: 'amber-copper', name: 'Amber Copper', primary: '#c4783a', primaryBright: '#d9945a', primaryDark: '#9d5c28', foregroundOnPrimary: '#ffffff' },
  { id: 'olive-gold', name: 'Olive Gold', primary: '#9a9b4a', primaryBright: '#b4b562', primaryDark: '#78793a', foregroundOnPrimary: '#000000' },
  { id: 'sage-blue', name: 'Sage Blue', primary: '#5a7a7a', primaryBright: '#739696', primaryDark: '#445d5d', foregroundOnPrimary: '#ffffff' },
  { id: 'dusty-rose', name: 'Dusty Rose', primary: '#c49a9a', primaryBright: '#dbb5b5', primaryDark: '#9a7272', foregroundOnPrimary: '#000000' },
  { id: 'muted-teal', name: 'Muted Teal', primary: '#4a7c7c', primaryBright: '#5e9999', primaryDark: '#385d5d', foregroundOnPrimary: '#ffffff' },
  { id: 'blush', name: 'Blush', primary: '#d4a5a5', primaryBright: '#e8c2c2', primaryDark: '#a67a7a', foregroundOnPrimary: '#000000' },
  { id: 'sea-green', name: 'Sea Green', primary: '#2e8b7a', primaryBright: '#3aa896', primaryDark: '#236b5d', foregroundOnPrimary: '#ffffff' },
  { id: 'berry', name: 'Berry', primary: '#8b4a6b', primaryBright: '#a65f85', primaryDark: '#6a3952', foregroundOnPrimary: '#ffffff' },
  { id: 'slate-blue', name: 'Slate Blue', primary: '#5c6b8a', primaryBright: '#7486a8', primaryDark: '#45526a', foregroundOnPrimary: '#ffffff' },
  { id: 'dusty-lavender', name: 'Dusty Lavender', primary: '#8b7a9a', primaryBright: '#a594b5', primaryDark: '#6a5c78', foregroundOnPrimary: '#ffffff' },
  { id: 'terracotta', name: 'Terracotta', primary: '#c4724a', primaryBright: '#d98e68', primaryDark: '#9a5736', foregroundOnPrimary: '#ffffff' },
  { id: 'honey-rose', name: 'Honey Rose', primary: '#d4957a', primaryBright: '#e8b09a', primaryDark: '#a86d52', foregroundOnPrimary: '#000000' },
  { id: 'emerald-teal', name: 'Emerald Teal', primary: '#1b8b73', primaryBright: '#22a88b', primaryDark: '#146858', foregroundOnPrimary: '#ffffff' },
  { id: 'indigo-violet', name: 'Indigo Violet', primary: '#5c4db8', primaryBright: '#7262d9', primaryDark: '#45399a', foregroundOnPrimary: '#ffffff' },
  { id: 'rust-gold', name: 'Rust Gold', primary: '#b87a3a', primaryBright: '#d49952', primaryDark: '#8f5c28', foregroundOnPrimary: '#ffffff' },
  { id: 'wine-plum', name: 'Wine Plum', primary: '#7e3d5c', primaryBright: '#9a5278', primaryDark: '#5e2d45', foregroundOnPrimary: '#ffffff' },
  { id: 'frost-blue', name: 'Frost Blue', primary: '#6b9bb5', primaryBright: '#85b5ce', primaryDark: '#507890', foregroundOnPrimary: '#000000' },
  { id: 'moss', name: 'Moss', primary: '#5c7a4a', primaryBright: '#739662', primaryDark: '#445d36', foregroundOnPrimary: '#ffffff' },

  /* More single & mixed */
  { id: 'salmon', name: 'Salmon', primary: '#f9736e', primaryBright: '#fb9a96', primaryDark: '#e85a55', foregroundOnPrimary: '#000000' },
  { id: 'mauve', name: 'Mauve', primary: '#9d7a9e', primaryBright: '#b894b9', primaryDark: '#7a5c7b', foregroundOnPrimary: '#ffffff' },
  { id: 'sepia', name: 'Sepia', primary: '#8b7355', primaryBright: '#a88b6a', primaryDark: '#6b5842', foregroundOnPrimary: '#ffffff' },
  { id: 'denim', name: 'Denim', primary: '#4a6fa5', primaryBright: '#5e86c4', primaryDark: '#385582', foregroundOnPrimary: '#ffffff' },
  { id: 'clay', name: 'Clay', primary: '#a67c52', primaryBright: '#c4996a', primaryDark: '#805c3a', foregroundOnPrimary: '#ffffff' },
  { id: 'moonlight', name: 'Moonlight', primary: '#7b8aa8', primaryBright: '#9aa8c4', primaryDark: '#5c6a85', foregroundOnPrimary: '#ffffff' },
  { id: 'camel', name: 'Camel', primary: '#c4a574', primaryBright: '#d9bc8f', primaryDark: '#9a7d52', foregroundOnPrimary: '#000000' },
  { id: 'aubergine', name: 'Aubergine', primary: '#5c3d5c', primaryBright: '#735073', primaryDark: '#452e45', foregroundOnPrimary: '#ffffff' },
  { id: 'spruce', name: 'Spruce', primary: '#2d5a4a', primaryBright: '#387562', primaryDark: '#224438', foregroundOnPrimary: '#ffffff' },
  { id: 'merlot', name: 'Merlot', primary: '#6b2d4a', primaryBright: '#853d62', primaryDark: '#502238', foregroundOnPrimary: '#ffffff' },
  { id: 'pewter-blue', name: 'Pewter Blue', primary: '#6b7a8a', primaryBright: '#8596a8', primaryDark: '#505d6b', foregroundOnPrimary: '#ffffff' },
  { id: 'apricot', name: 'Apricot', primary: '#e8a86a', primaryBright: '#f0c08e', primaryDark: '#c48348', foregroundOnPrimary: '#000000' },
  { id: 'thistle', name: 'Thistle', primary: '#a87ab0', primaryBright: '#c49bcc', primaryDark: '#825c8a', foregroundOnPrimary: '#ffffff' },
  { id: 'cedar', name: 'Cedar', primary: '#6b5344', primaryBright: '#856a5a', primaryDark: '#4d3d32', foregroundOnPrimary: '#ffffff' },
  { id: 'lagoon', name: 'Lagoon', primary: '#2a8b82', primaryBright: '#35a89e', primaryDark: '#1f6b64', foregroundOnPrimary: '#ffffff' },
  { id: 'mulberry', name: 'Mulberry', primary: '#7b4a7b', primaryBright: '#966296', primaryDark: '#5a385a', foregroundOnPrimary: '#ffffff' },
  { id: 'tangerine', name: 'Tangerine', primary: '#f07838', primaryBright: '#f59a5c', primaryDark: '#c45c28', foregroundOnPrimary: '#000000' },
  { id: 'steel-blue', name: 'Steel Blue', primary: '#4a6b8a', primaryBright: '#5e86aa', primaryDark: '#38526b', foregroundOnPrimary: '#ffffff' },
  { id: 'rose-quartz', name: 'Rose Quartz', primary: '#b8a0a8', primaryBright: '#d4bcc6', primaryDark: '#8a767e', foregroundOnPrimary: '#000000' },
  { id: 'bronze-green', name: 'Bronze Green', primary: '#5c6b4a', primaryBright: '#738662', primaryDark: '#445236', foregroundOnPrimary: '#ffffff' },

  /* Vivid gradients (editable vivid set – two-tone) */
  { id: 'gradient-green-teal', name: 'Green → Teal', primary: '#4de8bf', primaryBright: '#73ff8d', primaryDark: '#29cdb2', foregroundOnPrimary: '#000000' },
  { id: 'gradient-teal-pink', name: 'Teal → Pink', primary: '#6a84b7', primaryBright: '#26d6a6', primaryDark: '#cf3388', foregroundOnPrimary: '#ffffff' },
  { id: 'gradient-orange-yellow', name: 'Orange → Yellow', primary: '#ffc72f', primaryBright: '#ffe900', primaryDark: '#ffab5e', foregroundOnPrimary: '#000000' },
  { id: 'gradient-lime', name: 'Lime', primary: '#18ff29', primaryBright: '#2aff2c', primaryDark: '#01ff25', foregroundOnPrimary: '#000000' },
  { id: 'gradient-blue-deep', name: 'Blue → Deep Blue', primary: '#004faa', primaryBright: '#008faa', primaryDark: '#000faa', foregroundOnPrimary: '#ffffff' },
  { id: 'gradient-yellow-gold', name: 'Yellow → Gold', primary: '#e6d625', primaryBright: '#eeff2a', primaryDark: '#deac21', foregroundOnPrimary: '#000000' },
  { id: 'gradient-blue-orange', name: 'Blue → Orange', primary: '#6b70ff', primaryBright: '#0089ff', primaryDark: '#d75700', foregroundOnPrimary: '#ffffff' },
  { id: 'gradient-blue-sky', name: 'Blue → Sky', primary: '#3075d0', primaryBright: '#5fffec', primaryDark: '#008bff', foregroundOnPrimary: '#000000' },
  { id: 'gradient-green-forest', name: 'Green → Forest', primary: '#53dd22', primaryBright: '#5aff00', primaryDark: '#4c7a45', foregroundOnPrimary: '#000000' },
  { id: 'gradient-magenta-lavender', name: 'Magenta → Lavender', primary: '#b458c8', primaryBright: '#8f71ff', primaryDark: '#da4097', foregroundOnPrimary: '#ffffff' },
  { id: 'gradient-pink-purple', name: 'Pink → Purple', primary: '#e963f0', primaryBright: '#cd87ff', primaryDark: '#ff40e1', foregroundOnPrimary: '#ffffff' },
  { id: 'gradient-peach-pink', name: 'Peach → Pink', primary: '#fe8c9a', primaryBright: '#fec183', primaryDark: '#ff1572', foregroundOnPrimary: '#000000' },

  /* Multi-tone: 2–4 colour stops (stops array drives gradient) */
  { id: 'tone-2-sunset', name: '2-tone Sunset', stops: ['#ff6b4a', '#ffb347'], primary: '#ff6b4a', primaryBright: '#ff6b4a', primaryDark: '#ffb347', foregroundOnPrimary: '#000000' },
  { id: 'tone-2-ocean', name: '2-tone Ocean', stops: ['#0077b6', '#00b4d8'], primary: '#0077b6', primaryBright: '#0077b6', primaryDark: '#00b4d8', foregroundOnPrimary: '#ffffff' },
  { id: 'tone-2-forest', name: '2-tone Forest', stops: ['#2d6a4f', '#95d5b2'], primary: '#2d6a4f', primaryBright: '#2d6a4f', primaryDark: '#95d5b2', foregroundOnPrimary: '#ffffff' },
  { id: 'tone-2-berry', name: '2-tone Berry', stops: ['#7b2cbf', '#e0aaff'], primary: '#7b2cbf', primaryBright: '#7b2cbf', primaryDark: '#e0aaff', foregroundOnPrimary: '#ffffff' },
  { id: 'tone-3-fire', name: '3-tone Fire', stops: ['#ff0000', '#ff9500', '#ffea00'], primary: '#ff0000', primaryBright: '#ff0000', primaryDark: '#ffea00', foregroundOnPrimary: '#000000' },
  { id: 'tone-3-ocean-deep', name: '3-tone Ocean', stops: ['#03045e', '#0077b6', '#00b4d8'], primary: '#03045e', primaryBright: '#03045e', primaryDark: '#00b4d8', foregroundOnPrimary: '#ffffff' },
  { id: 'tone-3-sunset', name: '3-tone Sunset', stops: ['#ff6b6b', '#ffa94d', '#ffd93d'], primary: '#ff6b6b', primaryBright: '#ff6b6b', primaryDark: '#ffd93d', foregroundOnPrimary: '#000000' },
  { id: 'tone-3-aurora', name: '3-tone Aurora', stops: ['#06ffa5', '#00d4ff', '#7b2cbf'], primary: '#06ffa5', primaryBright: '#06ffa5', primaryDark: '#7b2cbf', foregroundOnPrimary: '#000000' },
  { id: 'tone-3-raspberry', name: '3-tone Raspberry', stops: ['#9d0208', '#dc2f02', '#e85d04'], primary: '#9d0208', primaryBright: '#9d0208', primaryDark: '#e85d04', foregroundOnPrimary: '#ffffff' },
  { id: 'tone-3-mint', name: '3-tone Mint', stops: ['#2d6a4f', '#40916c', '#95d5b2'], primary: '#2d6a4f', primaryBright: '#2d6a4f', primaryDark: '#95d5b2', foregroundOnPrimary: '#ffffff' },
  { id: 'tone-3-lavender', name: '3-tone Lavender', stops: ['#5a189a', '#9d4edd', '#e0aaff'], primary: '#5a189a', primaryBright: '#5a189a', primaryDark: '#e0aaff', foregroundOnPrimary: '#ffffff' },
  { id: 'tone-4-rainbow', name: '4-tone Rainbow', stops: ['#ff0000', '#ffaa00', '#00ff00', '#0088ff'], primary: '#ff0000', primaryBright: '#ff0000', primaryDark: '#0088ff', foregroundOnPrimary: '#ffffff' },
  { id: 'tone-4-sunset', name: '4-tone Sunset', stops: ['#1a1a2e', '#e94560', '#ff6b6b', '#ffd93d'], primary: '#1a1a2e', primaryBright: '#1a1a2e', primaryDark: '#ffd93d', foregroundOnPrimary: '#ffffff' },
  { id: 'tone-4-ocean', name: '4-tone Ocean', stops: ['#03045e', '#0077b6', '#00b4d8', '#90e0ef'], primary: '#03045e', primaryBright: '#03045e', primaryDark: '#90e0ef', foregroundOnPrimary: '#ffffff' },
  { id: 'tone-4-forest', name: '4-tone Forest', stops: ['#1b4332', '#2d6a4f', '#40916c', '#95d5b2'], primary: '#1b4332', primaryBright: '#1b4332', primaryDark: '#95d5b2', foregroundOnPrimary: '#ffffff' },
  { id: 'tone-4-candy', name: '4-tone Candy', stops: ['#ff006e', '#ff4081', '#ff79b0', '#ffb3d9'], primary: '#ff006e', primaryBright: '#ff006e', primaryDark: '#ffb3d9', foregroundOnPrimary: '#ffffff' },
  { id: 'tone-4-neon', name: '4-tone Neon', stops: ['#00f5d4', '#00bbf9', '#9b5de5', '#f15bb5'], primary: '#00f5d4', primaryBright: '#00f5d4', primaryDark: '#f15bb5', foregroundOnPrimary: '#000000' },
  { id: 'tone-4-ember', name: '4-tone Ember', stops: ['#370617', '#9d0208', '#dc2f02', '#e85d04'], primary: '#370617', primaryBright: '#370617', primaryDark: '#e85d04', foregroundOnPrimary: '#ffffff' },
  { id: 'tone-4-ice', name: '4-tone Ice', stops: ['#012a4a', '#013a63', '#014f86', '#89c2d9'], primary: '#012a4a', primaryBright: '#012a4a', primaryDark: '#89c2d9', foregroundOnPrimary: '#ffffff' },
  { id: 'tone-4-wine', name: '4-tone Wine', stops: ['#3c096c', '#5a189a', '#7b2cbf', '#c77dff'], primary: '#3c096c', primaryBright: '#3c096c', primaryDark: '#c77dff', foregroundOnPrimary: '#ffffff' },

  /* Dark teals + oranges / warm combos */
  { id: 'tone-2-teal-orange', name: 'Teal → Orange', stops: ['#0d9488', '#ea580c'], primary: '#0d9488', primaryBright: '#0d9488', primaryDark: '#ea580c', foregroundOnPrimary: '#ffffff' },
  { id: 'tone-2-dark-teal-amber', name: 'Dark Teal → Amber', stops: ['#134e4a', '#f59e0b'], primary: '#134e4a', primaryBright: '#134e4a', primaryDark: '#f59e0b', foregroundOnPrimary: '#ffffff' },
  { id: 'tone-2-deep-teal-orange', name: 'Deep Teal → Orange', stops: ['#0f766e', '#f97316'], primary: '#0f766e', primaryBright: '#0f766e', primaryDark: '#f97316', foregroundOnPrimary: '#ffffff' },
  { id: 'tone-3-teal-orange', name: '3-tone Teal Orange', stops: ['#0f766e', '#14b8a6', '#f97316'], primary: '#0f766e', primaryBright: '#0f766e', primaryDark: '#f97316', foregroundOnPrimary: '#ffffff' },
  { id: 'tone-3-dark-teal-amber', name: '3-tone Dark Teal Amber', stops: ['#134e4a', '#0d9488', '#fbbf24'], primary: '#134e4a', primaryBright: '#134e4a', primaryDark: '#fbbf24', foregroundOnPrimary: '#000000' },
  { id: 'tone-3-navy-teal-orange', name: '3-tone Navy Teal Orange', stops: ['#0c4a6e', '#0d9488', '#ea580c'], primary: '#0c4a6e', primaryBright: '#0c4a6e', primaryDark: '#ea580c', foregroundOnPrimary: '#ffffff' },
  { id: 'tone-4-teal-orange', name: '4-tone Teal Orange', stops: ['#134e4a', '#0d9488', '#14b8a6', '#f97316'], primary: '#134e4a', primaryBright: '#134e4a', primaryDark: '#f97316', foregroundOnPrimary: '#ffffff' },
  { id: 'tone-4-dark-teal-warm', name: '4-tone Dark Teal Warm', stops: ['#042f2e', '#0d9488', '#f59e0b', '#fbbf24'], primary: '#042f2e', primaryBright: '#042f2e', primaryDark: '#fbbf24', foregroundOnPrimary: '#ffffff' },
  { id: 'tone-2-cyan-amber', name: 'Cyan → Amber', stops: ['#0891b2', '#f59e0b'], primary: '#0891b2', primaryBright: '#0891b2', primaryDark: '#f59e0b', foregroundOnPrimary: '#000000' },
  { id: 'tone-2-slate-orange', name: 'Slate → Orange', stops: ['#475569', '#ea580c'], primary: '#475569', primaryBright: '#475569', primaryDark: '#ea580c', foregroundOnPrimary: '#ffffff' },
  { id: 'tone-3-midnight-teal-amber', name: '3-tone Midnight Teal Amber', stops: ['#0f172a', '#0d9488', '#f59e0b'], primary: '#0f172a', primaryBright: '#0f172a', primaryDark: '#f59e0b', foregroundOnPrimary: '#ffffff' },
  { id: 'tone-4-ocean-fire', name: '4-tone Ocean Fire', stops: ['#0c4a6e', '#0284c7', '#0d9488', '#ea580c'], primary: '#0c4a6e', primaryBright: '#0c4a6e', primaryDark: '#ea580c', foregroundOnPrimary: '#ffffff' },

  /* Glossy – richer, saturated, reflective feel */
  { id: 'glossy-gold', name: 'Glossy Gold', primary: '#e6c229', primaryBright: '#f5d654', primaryDark: '#c9a227', foregroundOnPrimary: '#000000' },
  { id: 'glossy-teal', name: 'Glossy Teal', primary: '#14b8a6', primaryBright: '#2dd4bf', primaryDark: '#0d9488', foregroundOnPrimary: '#000000' },
  { id: 'glossy-blue', name: 'Glossy Blue', primary: '#3b82f6', primaryBright: '#60a5fa', primaryDark: '#2563eb', foregroundOnPrimary: '#ffffff' },
  { id: 'glossy-rose', name: 'Glossy Rose', primary: '#f43f5e', primaryBright: '#fb7185', primaryDark: '#e11d48', foregroundOnPrimary: '#ffffff' },
  { id: 'glossy-emerald', name: 'Glossy Emerald', primary: '#10b981', primaryBright: '#34d399', primaryDark: '#059669', foregroundOnPrimary: '#000000' },
  { id: 'glossy-violet', name: 'Glossy Violet', primary: '#8b5cf6', primaryBright: '#a78bfa', primaryDark: '#7c3aed', foregroundOnPrimary: '#ffffff' },
  /* Matte – muted, flat, soft */
  { id: 'matte-slate', name: 'Matte Slate', primary: '#64748b', primaryBright: '#94a3b8', primaryDark: '#475569', foregroundOnPrimary: '#ffffff' },
  { id: 'matte-sage', name: 'Matte Sage', primary: '#5a6b5a', primaryBright: '#739673', primaryDark: '#445d44', foregroundOnPrimary: '#ffffff' },
  { id: 'matte-dust', name: 'Matte Dust', primary: '#a8a29e', primaryBright: '#d6d3d1', primaryDark: '#78716c', foregroundOnPrimary: '#000000' },
  { id: 'matte-mauve', name: 'Matte Mauve', primary: '#8b7a8e', primaryBright: '#a594a8', primaryDark: '#6a5c6e', foregroundOnPrimary: '#ffffff' },
  { id: 'matte-navy', name: 'Matte Navy', primary: '#334155', primaryBright: '#475569', primaryDark: '#1e293b', foregroundOnPrimary: '#ffffff' },
  { id: 'matte-terracotta', name: 'Matte Terracotta', primary: '#a67c6b', primaryBright: '#c49a8a', primaryDark: '#7a5a4a', foregroundOnPrimary: '#ffffff' },

  /* Extra deep darks */
  { id: 'deep-ink', name: 'Deep Ink', primary: '#0f172a', primaryBright: '#1e293b', primaryDark: '#020617', foregroundOnPrimary: '#ffffff' },
  { id: 'pitch', name: 'Pitch', primary: '#18181b', primaryBright: '#27272a', primaryDark: '#09090b', foregroundOnPrimary: '#ffffff' },
  { id: 'deep-navy', name: 'Deep Navy', primary: '#0c1929', primaryBright: '#1e3a5f', primaryDark: '#051018', foregroundOnPrimary: '#ffffff' },
  { id: 'deep-forest', name: 'Deep Forest', primary: '#052e16', primaryBright: '#14532d', primaryDark: '#021c0e', foregroundOnPrimary: '#ffffff' },
  { id: 'deep-wine', name: 'Deep Wine', primary: '#450a0a', primaryBright: '#7f1d1d', primaryDark: '#2a0606', foregroundOnPrimary: '#ffffff' },
  { id: 'deep-plum', name: 'Deep Plum', primary: '#3b0764', primaryBright: '#581c87', primaryDark: '#1e0332', foregroundOnPrimary: '#ffffff' },
  { id: 'shadow-dark', name: 'Shadow Dark', primary: '#1f2937', primaryBright: '#374151', primaryDark: '#111827', foregroundOnPrimary: '#ffffff' },
  { id: 'iron-dark', name: 'Iron Dark', primary: '#27272a', primaryBright: '#3f3f46', primaryDark: '#18181b', foregroundOnPrimary: '#ffffff' },
  { id: 'slate-deep', name: 'Slate Deep', primary: '#0f172a', primaryBright: '#1e293b', primaryDark: '#020617', foregroundOnPrimary: '#ffffff' },
  { id: 'teal-deep', name: 'Teal Deep', primary: '#042f2e', primaryBright: '#134e4a', primaryDark: '#021c1b', foregroundOnPrimary: '#ffffff' },
  /* Extra deep lights */
  { id: 'silk', name: 'Silk', primary: '#fefefe', primaryBright: '#ffffff', primaryDark: '#f5f5f5', foregroundOnPrimary: '#000000' },
  { id: 'snow-white', name: 'Snow White', primary: '#fffefe', primaryBright: '#ffffff', primaryDark: '#fafafa', foregroundOnPrimary: '#000000' },
  { id: 'linen-light', name: 'Linen Light', primary: '#fdf8f3', primaryBright: '#fefaf5', primaryDark: '#f5ebe0', foregroundOnPrimary: '#000000' },
  { id: 'pearl-white', name: 'Pearl White', primary: '#fcfcfb', primaryBright: '#ffffff', primaryDark: '#f0f0ee', foregroundOnPrimary: '#000000' },
  { id: 'ivory-light', name: 'Ivory Light', primary: '#fffff0', primaryBright: '#fffffa', primaryDark: '#f5f5e6', foregroundOnPrimary: '#000000' },
  { id: 'cream-light', name: 'Cream Light', primary: '#fffef5', primaryBright: '#fffffb', primaryDark: '#faf8eb', foregroundOnPrimary: '#000000' },
  { id: 'frost-white', name: 'Frost White', primary: '#f0faff', primaryBright: '#f8fcff', primaryDark: '#e0f2fe', foregroundOnPrimary: '#000000' },
  { id: 'blush-white', name: 'Blush White', primary: '#fff5f8', primaryBright: '#fffafc', primaryDark: '#fce7ef', foregroundOnPrimary: '#000000' },
  { id: 'mint-white', name: 'Mint White', primary: '#f0fff8', primaryBright: '#f7fffc', primaryDark: '#d1fae5', foregroundOnPrimary: '#000000' },
  /* Extra mid tones */
  { id: 'storm', name: 'Storm', primary: '#4b5563', primaryBright: '#6b7280', primaryDark: '#374151', foregroundOnPrimary: '#ffffff' },
  { id: 'fog', name: 'Fog', primary: '#9ca3af', primaryBright: '#d1d5db', primaryDark: '#6b7280', foregroundOnPrimary: '#000000' },
  { id: 'dove', name: 'Dove', primary: '#e5e7eb', primaryBright: '#f3f4f6', primaryDark: '#d1d5db', foregroundOnPrimary: '#000000' },
  { id: 'flint', name: 'Flint', primary: '#57534e', primaryBright: '#78716c', primaryDark: '#44403c', foregroundOnPrimary: '#ffffff' },
  { id: 'battleship', name: 'Battleship', primary: '#64748b', primaryBright: '#94a3b8', primaryDark: '#475569', foregroundOnPrimary: '#ffffff' },
  { id: 'mink', name: 'Mink', primary: '#78716c', primaryBright: '#a8a29e', primaryDark: '#57534e', foregroundOnPrimary: '#ffffff' },
  { id: 'taupe', name: 'Taupe', primary: '#8b7355', primaryBright: '#a88b6a', primaryDark: '#6b5842', foregroundOnPrimary: '#ffffff' },
  { id: 'sage-mid', name: 'Sage Mid', primary: '#6b7c6b', primaryBright: '#8a9e8a', primaryDark: '#4d5c4d', foregroundOnPrimary: '#ffffff' },
  { id: 'dust', name: 'Dust', primary: '#a8a29e', primaryBright: '#d6d3d1', primaryDark: '#78716c', foregroundOnPrimary: '#000000' },

  /* ── Jewel Tones ─────────────────────────────────────────── */
  { id: 'sapphire', name: 'Sapphire', primary: '#0f52ba', primaryBright: '#2563d4', primaryDark: '#0a3d8f', foregroundOnPrimary: '#ffffff' },
  { id: 'ruby', name: 'Ruby', primary: '#9b111e', primaryBright: '#c41e3a', primaryDark: '#7a0c17', foregroundOnPrimary: '#ffffff' },
  { id: 'topaz', name: 'Topaz', primary: '#ffc87c', primaryBright: '#ffd9a0', primaryDark: '#e6a84a', foregroundOnPrimary: '#000000' },
  { id: 'amethyst', name: 'Amethyst', primary: '#9966cc', primaryBright: '#b388e6', primaryDark: '#7b4fb3', foregroundOnPrimary: '#ffffff' },
  { id: 'onyx', name: 'Onyx', primary: '#353839', primaryBright: '#4a4d4e', primaryDark: '#1f2122', foregroundOnPrimary: '#ffffff' },
  { id: 'opal', name: 'Opal', primary: '#a8c3bc', primaryBright: '#c4dbd6', primaryDark: '#8aaba3', foregroundOnPrimary: '#000000' },
  { id: 'garnet', name: 'Garnet', primary: '#733635', primaryBright: '#944847', primaryDark: '#592929', foregroundOnPrimary: '#ffffff' },
  { id: 'peridot', name: 'Peridot', primary: '#b4c424', primaryBright: '#cdd940', primaryDark: '#92a01c', foregroundOnPrimary: '#000000' },
  { id: 'tanzanite', name: 'Tanzanite', primary: '#4d3d8f', primaryBright: '#6b5aaf', primaryDark: '#372b6b', foregroundOnPrimary: '#ffffff' },
  { id: 'tourmaline', name: 'Tourmaline', primary: '#86a17d', primaryBright: '#a3bb9b', primaryDark: '#6a8562', foregroundOnPrimary: '#000000' },
  { id: 'citrine', name: 'Citrine', primary: '#e4d00a', primaryBright: '#f0e030', primaryDark: '#c4b200', foregroundOnPrimary: '#000000' },
  { id: 'emerald-deep', name: 'Deep Emerald', primary: '#046307', primaryBright: '#068a0a', primaryDark: '#034a05', foregroundOnPrimary: '#ffffff' },
  { id: 'aquamarine', name: 'Aquamarine', primary: '#7fffd4', primaryBright: '#a0ffe3', primaryDark: '#50d4a8', foregroundOnPrimary: '#000000' },
  { id: 'lapis', name: 'Lapis Lazuli', primary: '#26619c', primaryBright: '#3a7cc2', primaryDark: '#1c4a78', foregroundOnPrimary: '#ffffff' },
  { id: 'jade-deep', name: 'Deep Jade', primary: '#00a86b', primaryBright: '#00cc82', primaryDark: '#008555', foregroundOnPrimary: '#ffffff' },

  /* ── Earth Tones ─────────────────────────────────────────── */
  { id: 'sandstone', name: 'Sandstone', primary: '#c2a278', primaryBright: '#d4b890', primaryDark: '#a88a60', foregroundOnPrimary: '#000000' },
  { id: 'mahogany', name: 'Mahogany', primary: '#c04000', primaryBright: '#e04d00', primaryDark: '#9a3300', foregroundOnPrimary: '#ffffff' },
  { id: 'sienna', name: 'Sienna', primary: '#a0522d', primaryBright: '#c06838', primaryDark: '#803f22', foregroundOnPrimary: '#ffffff' },
  { id: 'umber', name: 'Umber', primary: '#635147', primaryBright: '#7e685c', primaryDark: '#4a3c35', foregroundOnPrimary: '#ffffff' },
  { id: 'ochre', name: 'Ochre', primary: '#cc7722', primaryBright: '#e08830', primaryDark: '#a86018', foregroundOnPrimary: '#ffffff' },
  { id: 'loam', name: 'Loam', primary: '#5c4033', primaryBright: '#785440', primaryDark: '#463028', foregroundOnPrimary: '#ffffff' },
  { id: 'driftwood', name: 'Driftwood', primary: '#a89070', primaryBright: '#c0a888', primaryDark: '#8a7458', foregroundOnPrimary: '#000000' },
  { id: 'terra', name: 'Terra', primary: '#b85c38', primaryBright: '#d47040', primaryDark: '#964a2c', foregroundOnPrimary: '#ffffff' },
  { id: 'peat', name: 'Peat', primary: '#4a3b2a', primaryBright: '#6b5640', primaryDark: '#362a1e', foregroundOnPrimary: '#ffffff' },
  { id: 'bark', name: 'Bark', primary: '#6e4b3a', primaryBright: '#8c604c', primaryDark: '#55382b', foregroundOnPrimary: '#ffffff' },
  { id: 'wheat', name: 'Wheat', primary: '#d4a855', primaryBright: '#e4bc72', primaryDark: '#b89040', foregroundOnPrimary: '#000000' },
  { id: 'cinnamon', name: 'Cinnamon', primary: '#d27d2d', primaryBright: '#e89840', primaryDark: '#b06820', foregroundOnPrimary: '#ffffff' },

  /* ── Metallics ───────────────────────────────────────────── */
  { id: 'rose-gold-metal', name: 'Rose Gold Metallic', primary: '#b76e79', primaryBright: '#d4909a', primaryDark: '#9a5562', foregroundOnPrimary: '#ffffff' },
  { id: 'brushed-silver', name: 'Brushed Silver', primary: '#b0b7bc', primaryBright: '#cdd2d6', primaryDark: '#8e959b', foregroundOnPrimary: '#000000' },
  { id: 'dark-chrome', name: 'Dark Chrome', primary: '#5a5d60', primaryBright: '#787b7e', primaryDark: '#404345', foregroundOnPrimary: '#ffffff' },
  { id: 'polished-brass', name: 'Polished Brass', primary: '#c9a227', primaryBright: '#ddb940', primaryDark: '#a88520', foregroundOnPrimary: '#000000' },
  { id: 'antique-gold', name: 'Antique Gold', primary: '#c6993a', primaryBright: '#dab350', primaryDark: '#a87e28', foregroundOnPrimary: '#000000' },
  { id: 'bronze-dark', name: 'Dark Bronze', primary: '#665d1e', primaryBright: '#87792a', primaryDark: '#4d4616', foregroundOnPrimary: '#ffffff' },
  { id: 'platinum', name: 'Platinum', primary: '#e5e4e2', primaryBright: '#f2f1f0', primaryDark: '#c4c3c0', foregroundOnPrimary: '#000000' },
  { id: 'iron', name: 'Iron', primary: '#48494b', primaryBright: '#636466', primaryDark: '#333435', foregroundOnPrimary: '#ffffff' },
  { id: 'tin', name: 'Tin', primary: '#8e8e8e', primaryBright: '#ababab', primaryDark: '#707070', foregroundOnPrimary: '#000000' },
  { id: 'mercury', name: 'Mercury', primary: '#9db4c0', primaryBright: '#b8cdd8', primaryDark: '#7d9aaa', foregroundOnPrimary: '#000000' },

  /* ── Tropical ────────────────────────────────────────────── */
  { id: 'mango', name: 'Mango', primary: '#ff8243', primaryBright: '#ffa06a', primaryDark: '#e06a2e', foregroundOnPrimary: '#000000' },
  { id: 'papaya', name: 'Papaya', primary: '#ffa62f', primaryBright: '#ffbc5e', primaryDark: '#e08a18', foregroundOnPrimary: '#000000' },
  { id: 'guava', name: 'Guava', primary: '#ff6b81', primaryBright: '#ff8fa0', primaryDark: '#e04d65', foregroundOnPrimary: '#ffffff' },
  { id: 'hibiscus', name: 'Hibiscus', primary: '#b6316c', primaryBright: '#d44488', primaryDark: '#8e2454', foregroundOnPrimary: '#ffffff' },
  { id: 'palm', name: 'Palm', primary: '#2e8b57', primaryBright: '#3cb371', primaryDark: '#226b43', foregroundOnPrimary: '#ffffff' },
  { id: 'ocean-breeze', name: 'Ocean Breeze', primary: '#00b4d8', primaryBright: '#48cae4', primaryDark: '#0090ad', foregroundOnPrimary: '#000000' },
  { id: 'lagoon-deep', name: 'Deep Lagoon', primary: '#005f73', primaryBright: '#0a7e95', primaryDark: '#004654', foregroundOnPrimary: '#ffffff' },
  { id: 'coconut', name: 'Coconut', primary: '#c8a882', primaryBright: '#dcc0a0', primaryDark: '#aa8c66', foregroundOnPrimary: '#000000' },
  { id: 'plumeria', name: 'Plumeria', primary: '#f7cac9', primaryBright: '#fce0df', primaryDark: '#e8a8a6', foregroundOnPrimary: '#000000' },
  { id: 'tiki', name: 'Tiki', primary: '#e07b39', primaryBright: '#f09450', primaryDark: '#c46428', foregroundOnPrimary: '#ffffff' },

  /* ── Ice / Winter ────────────────────────────────────────── */
  { id: 'glacier', name: 'Glacier', primary: '#a0c4e8', primaryBright: '#c0daf0', primaryDark: '#78a8d4', foregroundOnPrimary: '#000000' },
  { id: 'arctic', name: 'Arctic', primary: '#dde9f0', primaryBright: '#eef4f8', primaryDark: '#b8ccd8', foregroundOnPrimary: '#000000' },
  { id: 'frostbite', name: 'Frostbite', primary: '#5b88a5', primaryBright: '#78a4c0', primaryDark: '#436d88', foregroundOnPrimary: '#ffffff' },
  { id: 'permafrost', name: 'Permafrost', primary: '#6e8898', primaryBright: '#8ca4b2', primaryDark: '#556d7c', foregroundOnPrimary: '#ffffff' },
  { id: 'ice-deep', name: 'Deep Ice', primary: '#4682b4', primaryBright: '#6198c8', primaryDark: '#326c9e', foregroundOnPrimary: '#ffffff' },
  { id: 'winter-sky', name: 'Winter Sky', primary: '#a4c8e1', primaryBright: '#c2ddf0', primaryDark: '#82b0d0', foregroundOnPrimary: '#000000' },
  { id: 'snowfall', name: 'Snowfall', primary: '#ccd5e0', primaryBright: '#e0e8f0', primaryDark: '#a8b4c4', foregroundOnPrimary: '#000000' },
  { id: 'polar', name: 'Polar', primary: '#88b3d0', primaryBright: '#a6c8e0', primaryDark: '#6a98b8', foregroundOnPrimary: '#000000' },
  { id: 'icicle', name: 'Icicle', primary: '#b8d4e8', primaryBright: '#d0e4f2', primaryDark: '#96bcd4', foregroundOnPrimary: '#000000' },
  { id: 'aurora-ice', name: 'Aurora Ice', primary: '#5e8c7a', primaryBright: '#78aa96', primaryDark: '#487260', foregroundOnPrimary: '#ffffff' },

  /* ── Cyberpunk / Neon ────────────────────────────────────── */
  { id: 'neon-violet', name: 'Neon Violet', primary: '#bf00ff', primaryBright: '#d44fff', primaryDark: '#9900cc', foregroundOnPrimary: '#ffffff' },
  { id: 'neon-cyan', name: 'Neon Cyan', primary: '#00fff7', primaryBright: '#66fff9', primaryDark: '#00ccca', foregroundOnPrimary: '#000000' },
  { id: 'neon-lime', name: 'Neon Lime', primary: '#b0ff00', primaryBright: '#ccff55', primaryDark: '#88cc00', foregroundOnPrimary: '#000000' },
  { id: 'synthwave', name: 'Synthwave', primary: '#ff2975', primaryBright: '#ff5c9a', primaryDark: '#cc1d5c', foregroundOnPrimary: '#ffffff' },
  { id: 'vaporwave', name: 'Vaporwave', primary: '#ff71ce', primaryBright: '#ff9ddd', primaryDark: '#e050b0', foregroundOnPrimary: '#000000' },
  { id: 'matrix', name: 'Matrix', primary: '#00ff41', primaryBright: '#55ff7c', primaryDark: '#00cc33', foregroundOnPrimary: '#000000' },
  { id: 'cyber-red', name: 'Cyber Red', primary: '#ff073a', primaryBright: '#ff4466', primaryDark: '#cc052e', foregroundOnPrimary: '#ffffff' },
  { id: 'plasma', name: 'Plasma', primary: '#ff00ff', primaryBright: '#ff55ff', primaryDark: '#cc00cc', foregroundOnPrimary: '#ffffff' },
  { id: 'hologram', name: 'Hologram', primary: '#30d5c8', primaryBright: '#60e8dd', primaryDark: '#20b0a5', foregroundOnPrimary: '#000000' },
  { id: 'laser', name: 'Laser', primary: '#fe0000', primaryBright: '#ff4444', primaryDark: '#cc0000', foregroundOnPrimary: '#ffffff' },

  /* ── Vintage / Retro ─────────────────────────────────────── */
  { id: 'retro-mustard', name: 'Retro Mustard', primary: '#c9a44a', primaryBright: '#dab862', primaryDark: '#a88838', foregroundOnPrimary: '#000000' },
  { id: 'avocado-70s', name: 'Avocado 70s', primary: '#568203', primaryBright: '#6ea004', primaryDark: '#406602', foregroundOnPrimary: '#ffffff' },
  { id: 'burnt-sienna', name: 'Burnt Sienna', primary: '#e97451', primaryBright: '#f09070', primaryDark: '#c85e3e', foregroundOnPrimary: '#ffffff' },
  { id: 'faded-denim', name: 'Faded Denim', primary: '#6b8cae', primaryBright: '#8aa8c6', primaryDark: '#547294', foregroundOnPrimary: '#ffffff' },
  { id: 'harvest', name: 'Harvest', primary: '#da9100', primaryBright: '#f0a820', primaryDark: '#b87800', foregroundOnPrimary: '#000000' },
  { id: 'parchment', name: 'Parchment', primary: '#dcd0b4', primaryBright: '#ede4cc', primaryDark: '#c4b898', foregroundOnPrimary: '#000000' },
  { id: 'rust-orange', name: 'Rust Orange', primary: '#c95700', primaryBright: '#e06e18', primaryDark: '#a04500', foregroundOnPrimary: '#ffffff' },
  { id: 'old-rose', name: 'Old Rose', primary: '#c08081', primaryBright: '#d49a9b', primaryDark: '#a06668', foregroundOnPrimary: '#ffffff' },
  { id: 'olive-drab', name: 'Olive Drab', primary: '#6b8e23', primaryBright: '#85aa30', primaryDark: '#556f1b', foregroundOnPrimary: '#ffffff' },
  { id: 'dusty-pink', name: 'Dusty Pink', primary: '#d4a5a5', primaryBright: '#e4bcbc', primaryDark: '#b88a8a', foregroundOnPrimary: '#000000' },

  /* ── Luxury ──────────────────────────────────────────────── */
  { id: 'champagne', name: 'Champagne', primary: '#f7e7ce', primaryBright: '#fdf2e2', primaryDark: '#e8d4b0', foregroundOnPrimary: '#000000' },
  { id: 'caviar', name: 'Caviar', primary: '#292929', primaryBright: '#404040', primaryDark: '#161616', foregroundOnPrimary: '#ffffff' },
  { id: 'truffle', name: 'Truffle', primary: '#3d2b1f', primaryBright: '#5a4030', primaryDark: '#2a1c14', foregroundOnPrimary: '#ffffff' },
  { id: 'cognac', name: 'Cognac', primary: '#9a463d', primaryBright: '#b85c52', primaryDark: '#7c3630', foregroundOnPrimary: '#ffffff' },
  { id: 'cashmere', name: 'Cashmere', primary: '#d1b89d', primaryBright: '#e2ceB5', primaryDark: '#b89e82', foregroundOnPrimary: '#000000' },
  { id: 'ebony', name: 'Ebony', primary: '#3c2415', primaryBright: '#583620', primaryDark: '#28180d', foregroundOnPrimary: '#ffffff' },
  { id: 'ivory-lux', name: 'Luxury Ivory', primary: '#fffff0', primaryBright: '#fffff8', primaryDark: '#e8e8d0', foregroundOnPrimary: '#000000' },
  { id: 'mink-fur', name: 'Mink Fur', primary: '#7b6c5b', primaryBright: '#988574', primaryDark: '#5f5346', foregroundOnPrimary: '#ffffff' },

  /* ── More Deep / Dark ────────────────────────────────────── */
  { id: 'deep-maroon', name: 'Deep Maroon', primary: '#4a0000', primaryBright: '#6e0000', primaryDark: '#300000', foregroundOnPrimary: '#ffffff' },
  { id: 'obsidian-blue', name: 'Obsidian Blue', primary: '#1a2744', primaryBright: '#283c62', primaryDark: '#101a30', foregroundOnPrimary: '#ffffff' },
  { id: 'void', name: 'Void', primary: '#0a0a0a', primaryBright: '#1a1a1a', primaryDark: '#000000', foregroundOnPrimary: '#ffffff' },
  { id: 'abyss', name: 'Abyss', primary: '#0c1222', primaryBright: '#1a2540', primaryDark: '#060a14', foregroundOnPrimary: '#ffffff' },
  { id: 'deep-olive', name: 'Deep Olive', primary: '#3b4a2a', primaryBright: '#506338', primaryDark: '#283418', foregroundOnPrimary: '#ffffff' },
  { id: 'deep-teal', name: 'Deep Teal', primary: '#004c4c', primaryBright: '#006e6e', primaryDark: '#003636', foregroundOnPrimary: '#ffffff' },
  { id: 'deep-amber', name: 'Deep Amber', primary: '#7a4400', primaryBright: '#9c5c00', primaryDark: '#5c3200', foregroundOnPrimary: '#ffffff' },
  { id: 'deep-rose', name: 'Deep Rose', primary: '#6b1839', primaryBright: '#8e2050', primaryDark: '#4e1028', foregroundOnPrimary: '#ffffff' },
  { id: 'deep-violet', name: 'Deep Violet', primary: '#2d1b69', primaryBright: '#42288a', primaryDark: '#1f1250', foregroundOnPrimary: '#ffffff' },
  { id: 'deep-copper', name: 'Deep Copper', primary: '#723c08', primaryBright: '#945210', primaryDark: '#542c04', foregroundOnPrimary: '#ffffff' },
  { id: 'deep-slate-green', name: 'Deep Slate Green', primary: '#2a3a30', primaryBright: '#3c5244', primaryDark: '#1c2820', foregroundOnPrimary: '#ffffff' },
  { id: 'deep-burgundy', name: 'Deep Burgundy', primary: '#4a0020', primaryBright: '#6e0032', primaryDark: '#300014', foregroundOnPrimary: '#ffffff' },
  { id: 'deep-bronze', name: 'Deep Bronze', primary: '#4a3620', primaryBright: '#684e30', primaryDark: '#342414', foregroundOnPrimary: '#ffffff' },
  { id: 'deep-charcoal', name: 'Deep Charcoal', primary: '#1c1c1e', primaryBright: '#2c2c2e', primaryDark: '#0e0e10', foregroundOnPrimary: '#ffffff' },
  { id: 'deep-sapphire', name: 'Deep Sapphire', primary: '#0c2461', primaryBright: '#133a8c', primaryDark: '#081840', foregroundOnPrimary: '#ffffff' },
  ...EXPANDED_THEME_COLOURS,
];

/** Display order: sections for main/button/line colours. Colours not listed go in "More". */
export const THEME_COLOUR_SECTIONS = [
  { label: 'Default', ids: ['sky'] },
  { label: 'Deep dark', ids: ['obsidian', 'carbon', 'gunmetal', 'deep-red', 'deep-blue', 'deep-green', 'deep-purple', 'deep-ink', 'pitch', 'deep-navy', 'deep-forest', 'deep-wine', 'deep-plum', 'shadow-dark', 'iron-dark', 'slate-deep', 'teal-deep', 'midnight', 'twilight'] },
  { label: 'Dark', ids: ['charcoal', 'graphite', 'blood', 'navy', 'ocean', 'forest', 'wine', 'plum', 'ash', 'smoke', 'pewter', 'titanium', 'steel', 'aubergine', 'spruce', 'merlot', 'cedar'] },
  { label: 'Mid', ids: ['slate', 'zinc', 'neutral', 'stone', 'storm', 'fog', 'flint', 'battleship', 'mink', 'taupe', 'sage-mid', 'dust', 'denim', 'moonlight', 'pewter-blue', 'mauve', 'sepia', 'clay', 'rose-quartz', 'bronze-green'] },
  { label: 'Light', ids: ['cream', 'ivory', 'silver', 'chrome', 'dove', 'silk', 'snow-white', 'linen-light', 'pearl-white', 'ivory-light', 'cream-light', 'frost-white', 'blush-white', 'mint-white'] },
  { label: 'Bright & vivid', ids: ['amber', 'yellow', 'orange', 'red', 'rose', 'crimson', 'fuchsia', 'violet', 'purple', 'indigo', 'blue', 'sky', 'cyan', 'teal', 'emerald', 'green', 'lime', 'olive', 'electric', 'royal', 'coral', 'peach', 'honey', 'mustard', 'saffron', 'tangerine', 'salmon'] },
  { label: 'Pastel', ids: ['pastel-pink', 'pastel-blue', 'pastel-green', 'pastel-purple', 'pastel-yellow'] },
  { label: 'Neon', ids: ['neon-green', 'neon-pink', 'neon-blue', 'neon-orange'] },
  { label: 'Mixed & blends', ids: ['rose-gold', 'copper-rose', 'gold-amber', 'teal-blue', 'violet-blue', 'blue-teal', 'sunset-blend', 'forest-teal', 'lavender-rose', 'peach-gold', 'coral-pink', 'mint-blue', 'plum-violet', 'amber-copper', 'olive-gold', 'sage-blue', 'dusty-rose', 'muted-teal', 'blush', 'sea-green', 'berry', 'slate-blue', 'dusty-lavender', 'terracotta', 'honey-rose', 'emerald-teal', 'indigo-violet', 'rust-gold', 'wine-plum', 'frost-blue', 'moss', 'thistle', 'apricot', 'camel', 'bronze', 'copper', 'rust', 'magenta', 'lavender', 'periwinkle', 'aqua', 'jade', 'sage', 'chartreuse', 'mint'] },
  { label: 'Gradients', ids: ['gradient-green-teal', 'gradient-teal-pink', 'gradient-orange-yellow', 'gradient-lime', 'gradient-blue-deep', 'gradient-yellow-gold', 'gradient-blue-orange', 'gradient-blue-sky', 'gradient-green-forest', 'gradient-magenta-lavender', 'gradient-pink-purple', 'gradient-peach-pink', 'tone-2-sunset', 'tone-2-ocean', 'tone-2-forest', 'tone-2-berry', 'tone-3-fire', 'tone-3-ocean-deep', 'tone-3-sunset', 'tone-3-aurora', 'tone-3-raspberry', 'tone-3-mint', 'tone-3-lavender', 'tone-4-rainbow', 'tone-4-sunset', 'tone-4-ocean', 'tone-4-forest', 'tone-4-candy', 'tone-4-neon', 'tone-4-ember', 'tone-4-ice', 'tone-4-wine', 'tone-2-teal-orange', 'tone-2-dark-teal-amber', 'tone-2-deep-teal-orange', 'tone-3-teal-orange', 'tone-3-dark-teal-amber', 'tone-3-navy-teal-orange', 'tone-4-teal-orange', 'tone-4-dark-teal-warm', 'tone-2-cyan-amber', 'tone-2-slate-orange', 'tone-3-midnight-teal-amber', 'tone-4-ocean-fire'] },
  { label: 'Glossy & matte', ids: ['glossy-gold', 'glossy-teal', 'glossy-blue', 'glossy-rose', 'glossy-emerald', 'glossy-violet', 'matte-slate', 'matte-sage', 'matte-dust', 'matte-mauve', 'matte-navy', 'matte-terracotta'] },
  { label: 'Jewel tones', ids: ['sapphire', 'ruby', 'topaz', 'amethyst', 'onyx', 'opal', 'garnet', 'peridot', 'tanzanite', 'tourmaline', 'citrine', 'emerald-deep', 'aquamarine', 'lapis', 'jade-deep'] },
  { label: 'Earth tones', ids: ['sandstone', 'mahogany', 'sienna', 'umber', 'ochre', 'loam', 'driftwood', 'terra', 'peat', 'bark', 'wheat', 'cinnamon'] },
  { label: 'Metallics', ids: ['rose-gold-metal', 'brushed-silver', 'dark-chrome', 'polished-brass', 'antique-gold', 'bronze-dark', 'platinum', 'iron', 'tin', 'mercury'] },
  { label: 'Tropical', ids: ['mango', 'papaya', 'guava', 'hibiscus', 'palm', 'ocean-breeze', 'lagoon-deep', 'coconut', 'plumeria', 'tiki'] },
  { label: 'Ice & winter', ids: ['glacier', 'arctic', 'frostbite', 'permafrost', 'ice-deep', 'winter-sky', 'snowfall', 'polar', 'icicle', 'aurora-ice'] },
  { label: 'Cyberpunk', ids: ['neon-violet', 'neon-cyan', 'neon-lime', 'synthwave', 'vaporwave', 'matrix', 'cyber-red', 'plasma', 'hologram', 'laser'] },
  { label: 'Vintage', ids: ['retro-mustard', 'avocado-70s', 'burnt-sienna', 'faded-denim', 'harvest', 'parchment', 'rust-orange', 'old-rose', 'olive-drab', 'dusty-pink'] },
  { label: 'Luxury', ids: ['champagne', 'caviar', 'truffle', 'cognac', 'cashmere', 'ebony', 'ivory-lux', 'mink-fur'] },
  { label: 'More', ids: ['sunset', 'sunrise', 'pale-gold', 'antique-brass', 'lagoon', 'mulberry', 'steel-blue', 'deep-maroon', 'obsidian-blue', 'void', 'abyss', 'deep-olive', 'deep-teal', 'deep-amber', 'deep-rose', 'deep-violet', 'deep-copper', 'deep-slate-green', 'deep-burgundy', 'deep-bronze', 'deep-charcoal', 'deep-sapphire'] },
  EXPANDED_COLOUR_SECTION,
];

/** Texture presets: applied as body overlay. id used for body[data-texture] and swatch preview. */
export const THEME_TEXTURES = [
  { id: 'none', name: 'None' },
  { id: 'modern-soft', name: 'Modern Soft' },
  { id: 'grid', name: 'Grid' },
  { id: 'lines', name: 'Lines' },
  { id: 'crosshatch', name: 'Crosshatch' },
  { id: 'hexagons', name: 'Hexagons' },
  { id: 'fine-lines', name: 'Fine Lines' },
  ...EXPANDED_THEME_TEXTURES,
];

/** Writing style: heading + body font family (CSS font-family value). */
export const THEME_FONTS = [
  { id: 'classic', name: 'Classic', heading: '"Playfair Display", Georgia, serif', body: 'Inter, system-ui, sans-serif' },
  { id: 'modern', name: 'Modern', heading: 'system-ui, -apple-system, sans-serif', body: 'system-ui, -apple-system, sans-serif' },
  { id: 'newspaper', name: 'Newspaper', heading: 'Georgia, "Times New Roman", serif', body: 'Georgia, "Times New Roman", serif' },
  { id: 'clean', name: 'Clean', heading: '"Segoe UI", system-ui, sans-serif', body: '"Segoe UI", system-ui, sans-serif' },
  { id: 'compact', name: 'Compact', heading: 'Inter, system-ui, sans-serif', body: 'Inter, system-ui, sans-serif' },
  { id: 'mono', name: 'Mono', heading: '"JetBrains Mono", "Fira Code", monospace', body: '"JetBrains Mono", "Fira Code", monospace' },
  { id: 'elegant', name: 'Elegant', heading: '"Cormorant Garamond", Garamond, serif', body: '"Cormorant Garamond", Garamond, serif' },
  { id: 'industrial', name: 'Industrial', heading: 'Oswald, "Arial Narrow", sans-serif', body: 'Inter, system-ui, sans-serif' },
  { id: 'rounded', name: 'Rounded', heading: 'Nunito, "Varela Round", sans-serif', body: 'Nunito, "Varela Round", sans-serif' },
  { id: 'typewriter', name: 'Typewriter', heading: '"Courier Prime", "Courier New", monospace', body: '"Courier Prime", "Courier New", monospace' },
  { id: 'minimal', name: 'Minimal', heading: 'Lato, "Helvetica Neue", sans-serif', body: 'Lato, "Helvetica Neue", sans-serif' },
  { id: 'bold', name: 'Bold', heading: 'Montserrat, "Trebuchet MS", sans-serif', body: 'Montserrat, "Trebuchet MS", sans-serif' },
  { id: 'retro', name: 'Retro', heading: '"Bebas Neue", Impact, sans-serif', body: 'Inter, system-ui, sans-serif' },
  { id: 'handwritten', name: 'Handwritten', heading: 'Caveat, "Comic Sans MS", cursive', body: 'Caveat, "Comic Sans MS", cursive' },
  { id: 'luxury', name: 'Luxury', heading: 'Cinzel, "Trajan Pro", serif', body: 'Inter, system-ui, sans-serif' },
  { id: 'tech', name: 'Tech', heading: '"Space Grotesk", "IBM Plex Sans", sans-serif', body: '"Space Grotesk", "IBM Plex Sans", sans-serif' },
  { id: 'editorial', name: 'Editorial', heading: 'Merriweather, Georgia, serif', body: 'Merriweather, Georgia, serif' },
  { id: 'geometric', name: 'Geometric', heading: 'Poppins, "Century Gothic", sans-serif', body: 'Poppins, "Century Gothic", sans-serif' },
  { id: 'humanist', name: 'Humanist', heading: '"Source Sans 3", "Lucida Grande", sans-serif', body: '"Source Sans 3", "Lucida Grande", sans-serif' },
  { id: 'slab', name: 'Slab', heading: '"Roboto Slab", Rockwell, serif', body: '"Roboto Slab", Rockwell, serif' },
  ...EXPANDED_THEME_FONTS,
];

/** Text style: weight and slant (applies to body/heading base). */
export const THEME_TEXT_STYLES = [
  { id: 'normal', name: 'Normal', fontWeight: '400', fontStyle: 'normal' },
  { id: 'bold', name: 'Bold', fontWeight: '700', fontStyle: 'normal' },
  { id: 'italic', name: 'Italic', fontWeight: '400', fontStyle: 'italic' },
  { id: 'bold-italic', name: 'Bold italic', fontWeight: '700', fontStyle: 'italic' },
  { id: 'light', name: 'Light', fontWeight: '300', fontStyle: 'normal' },
  { id: 'medium', name: 'Medium', fontWeight: '500', fontStyle: 'normal' },
  { id: 'semibold', name: 'Semibold', fontWeight: '600', fontStyle: 'normal' },
];

/** Button style: look and feel of primary buttons. */
export const THEME_BUTTON_STYLES = [
  { id: 'original', name: 'Original' },
  { id: 'glossy', name: 'Glossy' },
  { id: 'shaded', name: 'Shaded' },
  { id: 'opaque', name: 'Opaque' },
  { id: 'shadow', name: 'Shadow' },
  { id: 'raised', name: 'Raised' },
  { id: 'flat', name: 'Flat' },
  { id: 'outline', name: 'Outline' },
];

/** Divider style: sidebar/menu divider line appearance (when dividers are on). */
export const THEME_DIVIDER_STYLES = [
  { id: 'solid', name: 'Solid' },
  { id: 'dotted', name: 'Dotted' },
  { id: 'dashed', name: 'Dashed' },
];

/** Button shape: corner radius of primary buttons. */
export const THEME_BUTTON_SHAPES = [
  { id: 'sharp', name: 'Sharp' },
  { id: 'rounded', name: 'Rounded' },
  { id: 'pill', name: 'Pill' },
];

/** Sidebar spacing: vertical density of menu items. */
export const THEME_SIDEBAR_SPACING = [
  { id: 'compact', name: 'Compact' },
  { id: 'normal', name: 'Normal' },
  { id: 'relaxed', name: 'Relaxed' },
];

/** Sidebar layout: flat list vs categorized with headers. */
export const THEME_SIDEBAR_LAYOUT = [
  { id: 'default', name: 'Flat list', description: 'Single continuous nav list — no section headers' },
  { id: 'categorized', name: 'Grouped', description: 'Collapsible sections (Information, Ranking, Money…)' },
  { id: 'categorized_classic', name: 'Grouped classic', description: 'Section headers always visible — original mafia chrome' },
];

/** Toast notification position. */
export const THEME_TOAST_POSITION = [
  { id: 'top-left', name: 'Top left' },
  { id: 'top-center', name: 'Top center' },
  { id: 'top-right', name: 'Top right' },
  { id: 'bottom-left', name: 'Bottom left' },
  { id: 'bottom-center', name: 'Bottom center' },
  { id: 'bottom-right', name: 'Bottom right' },
  { id: 'custom', name: 'Custom (drag to set)' },
];

/** Writing (text) colour: main body and muted text. { id, name, foreground, muted } hex. */
export const THEME_WRITING_COLOURS = [
  /* Default & light */
  { id: 'default', name: 'Default', foreground: '#f5f5f5', muted: '#a1a1aa' },
  { id: 'snow', name: 'Snow', foreground: '#fafafa', muted: '#d4d4d4' },
  { id: 'pearl', name: 'Pearl', foreground: '#f5f5f4', muted: '#a8a29e' },
  { id: 'ivory-text', name: 'Ivory', foreground: '#fefce8', muted: '#e7e5e4' },
  { id: 'cream-text', name: 'Cream', foreground: '#fffbeb', muted: '#d6d3d1' },
  { id: 'warm-white', name: 'Warm White', foreground: '#fef3c7', muted: '#fde68a' },
  { id: 'cool-white', name: 'Cool White', foreground: '#f0f9ff', muted: '#bae6fd' },
  { id: 'bone', name: 'Bone', foreground: '#faf6f0', muted: '#e8e2d8' },
  { id: 'eggshell', name: 'Eggshell', foreground: '#f0ebe3', muted: '#c9c2b5' },
  { id: 'linen', name: 'Linen', foreground: '#faf0e6', muted: '#e8dcc8' },
  { id: 'vanilla', name: 'Vanilla', foreground: '#fef9e7', muted: '#f5e6b3' },
  { id: 'honeydew', name: 'Honeydew', foreground: '#f0fff0', muted: '#c6f6c6' },
  { id: 'azure', name: 'Azure', foreground: '#f0f8ff', muted: '#b8daff' },
  { id: 'alabaster', name: 'Alabaster', foreground: '#fafafa', muted: '#e8e8e8' },
  { id: 'chalk', name: 'Chalk', foreground: '#f7f7f7', muted: '#d0d0d0' },
  { id: 'milk', name: 'Milk', foreground: '#fefefe', muted: '#e0e0e0' },
  /* Grays – light to dark */
  { id: 'gray-50', name: 'Gray 50', foreground: '#f9fafb', muted: '#e5e7eb' },
  { id: 'gray-100', name: 'Gray 100', foreground: '#f3f4f6', muted: '#d1d5db' },
  { id: 'gray-200', name: 'Gray 200', foreground: '#e5e7eb', muted: '#9ca3af' },
  { id: 'gray-300', name: 'Gray 300', foreground: '#d1d5db', muted: '#6b7280' },
  { id: 'gray-400', name: 'Gray 400', foreground: '#9ca3af', muted: '#4b5563' },
  { id: 'gray-500', name: 'Gray 500', foreground: '#6b7280', muted: '#374151' },
  { id: 'zinc-100', name: 'Zinc 100', foreground: '#f4f4f5', muted: '#a1a1aa' },
  { id: 'zinc-200', name: 'Zinc 200', foreground: '#e4e4e7', muted: '#71717a' },
  { id: 'zinc-300', name: 'Zinc 300', foreground: '#d4d4d8', muted: '#52525b' },
  { id: 'zinc-400', name: 'Zinc 400', foreground: '#a1a1aa', muted: '#3f3f46' },
  { id: 'zinc-500', name: 'Zinc 500', foreground: '#71717a', muted: '#27272a' },
  { id: 'slate-200', name: 'Slate 200', foreground: '#e2e8f0', muted: '#94a3b8' },
  { id: 'slate-300', name: 'Slate 300', foreground: '#cbd5e1', muted: '#64748b' },
  { id: 'slate-400', name: 'Slate 400', foreground: '#94a3b8', muted: '#475569' },
  { id: 'slate-500', name: 'Slate 500', foreground: '#64748b', muted: '#334155' },
  { id: 'stone-200', name: 'Stone 200', foreground: '#e7e5e4', muted: '#a8a29e' },
  { id: 'stone-300', name: 'Stone 300', foreground: '#d6d3d1', muted: '#78716c' },
  { id: 'stone-400', name: 'Stone 400', foreground: '#a8a29e', muted: '#57534e' },
  { id: 'neutral-300', name: 'Neutral 300', foreground: '#d4d4d4', muted: '#737373' },
  { id: 'neutral-400', name: 'Neutral 400', foreground: '#a3a3a3', muted: '#525252' },
  /* Dark */
  { id: 'charcoal-text', name: 'Charcoal', foreground: '#3f3f46', muted: '#71717a' },
  { id: 'graphite-text', name: 'Graphite', foreground: '#44403c', muted: '#57534e' },
  { id: 'smoke-text', name: 'Smoke', foreground: '#52525b', muted: '#3f3f46' },
  { id: 'carbon-text', name: 'Carbon', foreground: '#3f3f46', muted: '#27272a' },
  { id: 'obsidian-text', name: 'Obsidian', foreground: '#27272a', muted: '#18181b' },
  { id: 'ink', name: 'Ink', foreground: '#1f2937', muted: '#374151' },
  { id: 'midnight-text', name: 'Midnight', foreground: '#1e1b4b', muted: '#312e81' },
  { id: 'iron', name: 'Iron', foreground: '#434343', muted: '#5c5c5c' },
  { id: 'lead', name: 'Lead', foreground: '#4a4a4a', muted: '#6b6b6b' },
  { id: 'ash-dark', name: 'Ash Dark', foreground: '#3d3d3d', muted: '#525252' },
  /* Tinted – warm */
  { id: 'warm-gray', name: 'Warm Gray', foreground: '#f5f5f4', muted: '#a8a29e' },
  { id: 'sepia-text', name: 'Sepia', foreground: '#f5f0e6', muted: '#d4c4a8' },
  { id: 'parchment', name: 'Parchment', foreground: '#faf8f5', muted: '#c9b896' },
  { id: 'amber-text', name: 'Amber', foreground: '#fffbeb', muted: '#fde68a' },
  { id: 'saffron-text', name: 'Saffron', foreground: '#fef3c7', muted: '#fcd34d' },
  { id: 'butter', name: 'Butter', foreground: '#fefce8', muted: '#fef08a' },
  { id: 'wheat', name: 'Wheat', foreground: '#faf0dc', muted: '#e8d4a8' },
  { id: 'sand', name: 'Sand', foreground: '#f5e6d3', muted: '#d4b896' },
  { id: 'caramel', name: 'Caramel', foreground: '#f5e6d3', muted: '#c9a86c' },
  { id: 'toast', name: 'Toast', foreground: '#e8dcc8', muted: '#c4b098' },
  { id: 'terracotta-text', name: 'Terracotta', foreground: '#f5e6e0', muted: '#d4a090' },
  { id: 'clay', name: 'Clay', foreground: '#ede0d4', muted: '#c4a090' },
  /* Tinted – cool */
  { id: 'cool-gray', name: 'Cool Gray', foreground: '#f1f5f9', muted: '#94a3b8' },
  { id: 'blue-gray', name: 'Blue Gray', foreground: '#e2e8f0', muted: '#64748b' },
  { id: 'frost', name: 'Frost', foreground: '#ecfeff', muted: '#a5f3fc' },
  { id: 'ice', name: 'Ice', foreground: '#f0f9ff', muted: '#7dd3fc' },
  { id: 'mist', name: 'Mist', foreground: '#f0f4f8', muted: '#94a3b8' },
  { id: 'steel-text', name: 'Steel', foreground: '#e8eef4', muted: '#94a3b8' },
  { id: 'silver-text', name: 'Silver', foreground: '#f4f4f5', muted: '#a1a1aa' },
  /* Tinted – pastels */
  { id: 'blush-text', name: 'Blush', foreground: '#fdf2f8', muted: '#f9a8d4' },
  { id: 'rose-text', name: 'Rose', foreground: '#fff1f2', muted: '#fecdd3' },
  { id: 'pink-text', name: 'Pink', foreground: '#fce7f3', muted: '#fbcfe8' },
  { id: 'lavender-text', name: 'Lavender', foreground: '#f5f3ff', muted: '#c4b5fd' },
  { id: 'lilac', name: 'Lilac', foreground: '#faf5ff', muted: '#e9d5ff' },
  { id: 'violet-text', name: 'Violet', foreground: '#f5f3ff', muted: '#ddd6fe' },
  { id: 'mauve', name: 'Mauve', foreground: '#f5f0ff', muted: '#d4c4f0' },
  { id: 'mint-text', name: 'Mint', foreground: '#f0fdf4', muted: '#86efac' },
  { id: 'sage-text', name: 'Sage', foreground: '#f0fdf4', muted: '#bbf7d0' },
  { id: 'seafoam', name: 'Seafoam', foreground: '#f0fdfa', muted: '#99f6e4' },
  { id: 'aqua-text', name: 'Aqua', foreground: '#ecfeff', muted: '#67e8f9' },
  { id: 'sky-text', name: 'Sky', foreground: '#f0f9ff', muted: '#bae6fd' },
  { id: 'powder-blue', name: 'Powder Blue', foreground: '#eff6ff', muted: '#bfdbfe' },
  { id: 'periwinkle-text', name: 'Periwinkle', foreground: '#eef2ff', muted: '#c7d2fe' },
  /* Stronger tints */
  { id: 'gold-text', name: 'Gold', foreground: '#fef9c3', muted: '#fde047' },
  { id: 'cream-gold', name: 'Cream Gold', foreground: '#fefce8', muted: '#fde68a' },
  { id: 'peach-text', name: 'Peach', foreground: '#fff7ed', muted: '#fed7aa' },
  { id: 'coral-text', name: 'Coral', foreground: '#fff5f5', muted: '#fecaca' },
  { id: 'salmon', name: 'Salmon', foreground: '#fff0f0', muted: '#fecaca' },
  { id: 'melon', name: 'Melon', foreground: '#fff5f0', muted: '#fed7c4' },
  { id: 'lavender-rose-text', name: 'Lavender Rose', foreground: '#fdf4ff', muted: '#f5d0fe' },
  { id: 'thistle', name: 'Thistle', foreground: '#faf5ff', muted: '#e9d5ff' },
  { id: 'eucalyptus', name: 'Eucalyptus', foreground: '#ecfdf5', muted: '#a7f3d0' },
  { id: 'spearmint', name: 'Spearmint', foreground: '#f0fdf4', muted: '#bbf7d0' },
  { id: 'turquoise-text', name: 'Turquoise', foreground: '#ecfeff', muted: '#5eead4' },
  { id: 'arctic', name: 'Arctic', foreground: '#f0f9ff', muted: '#7dd3fc' },
  { id: 'cornflower', name: 'Cornflower', foreground: '#eff6ff', muted: '#93c5fd' },
  { id: 'bluebell', name: 'Bluebell', foreground: '#eef2ff', muted: '#a5b4fc' },
  /* Extra darks */
  { id: 'graphite-dark', name: 'Graphite Dark', foreground: '#292524', muted: '#44403c' },
  { id: 'slate-dark', name: 'Slate Dark', foreground: '#334155', muted: '#475569' },
  { id: 'navy-text', name: 'Navy', foreground: '#1e3a5f', muted: '#2563eb' },
  { id: 'forest-text', name: 'Forest', foreground: '#14532d', muted: '#166534' },
  { id: 'burgundy-text', name: 'Burgundy', foreground: '#4c0519', muted: '#881337' },
  { id: 'plum-dark', name: 'Plum Dark', foreground: '#3b0764', muted: '#6b21a8' },
  /* More lights – bright and clear */
  { id: 'pure-white', name: 'Pure White', foreground: '#ffffff', muted: '#e5e5e5' },
  { id: 'bright-white', name: 'Bright White', foreground: '#fefefe', muted: '#dcdcdc' },
  { id: 'paper', name: 'Paper', foreground: '#fafaf8', muted: '#e0e0dc' },
  { id: 'off-white', name: 'Off White', foreground: '#f8f8f6', muted: '#c8c8c4' },
  { id: 'light-1', name: 'Light 1', foreground: '#f5f5f5', muted: '#b0b0b0' },
  { id: 'light-2', name: 'Light 2', foreground: '#eeeeee', muted: '#9e9e9e' },
  { id: 'light-3', name: 'Light 3', foreground: '#e0e0e0', muted: '#757575' },
  { id: 'pearl-light', name: 'Pearl Light', foreground: '#fcfcfb', muted: '#d8d8d4' },
  { id: 'snow-light', name: 'Snow Light', foreground: '#fafafa', muted: '#cacaca' },
  { id: 'cloud', name: 'Cloud', foreground: '#f2f2f2', muted: '#a8a8a8' },
  /* More darks – deep and saturated */
  { id: 'dark-1', name: 'Dark 1', foreground: '#2d2d2d', muted: '#1a1a1a' },
  { id: 'dark-2', name: 'Dark 2', foreground: '#252525', muted: '#141414' },
  { id: 'dark-3', name: 'Dark 3', foreground: '#1c1c1c', muted: '#0d0d0d' },
  { id: 'dark-charcoal', name: 'Dark Charcoal', foreground: '#2a2a2a', muted: '#181818' },
  { id: 'dark-brown-grey', name: 'Dark Brown Grey', foreground: '#3d3835', muted: '#2a2624' },
  { id: 'dark-indigo', name: 'Dark Indigo', foreground: '#312e81', muted: '#1e1b4b' },
  { id: 'dark-blue', name: 'Dark Blue', foreground: '#1e3a8a', muted: '#172554' },
  { id: 'dark-purple', name: 'Dark Purple', foreground: '#581c87', muted: '#3b0764' },
  { id: 'dark-maroon', name: 'Dark Maroon', foreground: '#7f1d1d', muted: '#450a0a' },
  { id: 'dark-forest', name: 'Dark Forest', foreground: '#14532d', muted: '#052e16' },
  { id: 'dark-teal', name: 'Dark Teal', foreground: '#134e4a', muted: '#042f2e' },
  { id: 'dark-slate', name: 'Dark Slate', foreground: '#1e293b', muted: '#0f172a' },
  { id: 'shadow', name: 'Shadow', foreground: '#374151', muted: '#1f2937' },
  { id: 'onyx', name: 'Onyx', foreground: '#1c1c1e', muted: '#0a0a0b' },
  /* Vibrant – like the reference (neon orange, hot pink, royal blue, bright green) */
  { id: 'neon-orange', name: 'Neon Orange', foreground: '#f97316', muted: '#ea580c' },
  { id: 'neon-orange-light', name: 'Neon Orange Light', foreground: '#fb923c', muted: '#f97316' },
  { id: 'hot-pink', name: 'Hot Pink', foreground: '#ec4899', muted: '#db2777' },
  { id: 'hot-pink-light', name: 'Hot Pink Light', foreground: '#f472b6', muted: '#ec4899' },
  { id: 'royal-blue', name: 'Royal Blue', foreground: '#2563eb', muted: '#1d4ed8' },
  { id: 'royal-blue-light', name: 'Royal Blue Light', foreground: '#3b82f6', muted: '#2563eb' },
  { id: 'bright-green', name: 'Bright Green', foreground: '#22c55e', muted: '#16a34a' },
  { id: 'bright-green-light', name: 'Bright Green Light', foreground: '#4ade80', muted: '#22c55e' },
  { id: 'bright-yellow', name: 'Bright Yellow', foreground: '#eab308', muted: '#ca8a04' },
  { id: 'bright-yellow-light', name: 'Bright Yellow Light', foreground: '#facc15', muted: '#eab308' },
  { id: 'burnt-orange', name: 'Burnt Orange', foreground: '#c2410c', muted: '#9a3412' },
  { id: 'deep-red', name: 'Deep Red', foreground: '#b91c1c', muted: '#991b1b' },
  { id: 'vibrant-cyan', name: 'Vibrant Cyan', foreground: '#06b6d4', muted: '#0891b2' },
  { id: 'vibrant-purple', name: 'Vibrant Purple', foreground: '#a855f7', muted: '#9333ea' },
  { id: 'vibrant-rose', name: 'Vibrant Rose', foreground: '#f43f5e', muted: '#e11d48' },
  { id: 'electric-blue', name: 'Electric Blue', foreground: '#0ea5e9', muted: '#0284c7' },
  /* Pastel lights (like second ref – soft but distinct) */
  { id: 'pastel-orange', name: 'Pastel Orange', foreground: '#ffedd5', muted: '#fed7aa' },
  { id: 'pastel-yellow', name: 'Pastel Yellow', foreground: '#fef9c3', muted: '#fde047' },
  { id: 'pastel-pink-light', name: 'Pastel Pink', foreground: '#fce7f3', muted: '#f9a8d4' },
  { id: 'pastel-blue-light', name: 'Pastel Blue', foreground: '#dbeafe', muted: '#93c5fd' },
  { id: 'pastel-green-light', name: 'Pastel Green', foreground: '#dcfce7', muted: '#86efac' },
  { id: 'pastel-lavender', name: 'Pastel Lavender', foreground: '#ede9fe', muted: '#c4b5fd' },
  { id: 'pastel-mint', name: 'Pastel Mint', foreground: '#d1fae5', muted: '#6ee7b7' },
  { id: 'pastel-sky', name: 'Pastel Sky', foreground: '#e0f2fe', muted: '#7dd3fc' },
  { id: 'pastel-peach', name: 'Pastel Peach', foreground: '#fff7ed', muted: '#ffd6a5' },
  { id: 'pastel-rose', name: 'Pastel Rose', foreground: '#ffe4e6', muted: '#fda4af' },
  /* Mid greys – stepped light to dark */
  { id: 'grey-150', name: 'Grey 150', foreground: '#f1f1f1', muted: '#bdbdbd' },
  { id: 'grey-250', name: 'Grey 250', foreground: '#e0e0e0', muted: '#9e9e9e' },
  { id: 'grey-350', name: 'Grey 350', foreground: '#bdbdbd', muted: '#757575' },
  { id: 'grey-450', name: 'Grey 450', foreground: '#9e9e9e', muted: '#616161' },
  { id: 'grey-550', name: 'Grey 550', foreground: '#757575', muted: '#424242' },
  { id: 'grey-650', name: 'Grey 650', foreground: '#616161', muted: '#303030' },
  { id: 'grey-750', name: 'Grey 750', foreground: '#424242', muted: '#212121' },
  { id: 'grey-850', name: 'Grey 850', foreground: '#303030', muted: '#121212' },
  /* Extra deep darks */
  { id: 'ink-deep', name: 'Ink Deep', foreground: '#0f172a', muted: '#1e293b' },
  { id: 'pitch-text', name: 'Pitch', foreground: '#18181b', muted: '#27272a' },
  { id: 'obsidian-deep', name: 'Obsidian Deep', foreground: '#09090b', muted: '#18181b' },
  { id: 'midnight-ink', name: 'Midnight Ink', foreground: '#0c1929', muted: '#1e3a5f' },
  { id: 'forest-ink', name: 'Forest Ink', foreground: '#052e16', muted: '#14532d' },
  { id: 'wine-ink', name: 'Wine Ink', foreground: '#450a0a', muted: '#7f1d1d' },
  { id: 'plum-ink', name: 'Plum Ink', foreground: '#3b0764', muted: '#581c87' },
  { id: 'slate-ink', name: 'Slate Ink', foreground: '#0f172a', muted: '#334155' },
  { id: 'teal-ink', name: 'Teal Ink', foreground: '#042f2e', muted: '#134e4a' },
  { id: 'carbon-deep', name: 'Carbon Deep', foreground: '#27272a', muted: '#3f3f46' },
  /* Extra deep lights */
  { id: 'silk-text', name: 'Silk', foreground: '#fefefe', muted: '#e8e8e8' },
  { id: 'snow-deep', name: 'Snow Deep', foreground: '#fffefe', muted: '#f0f0f0' },
  { id: 'linen-text', name: 'Linen', foreground: '#fdf8f3', muted: '#f0e6dc' },
  { id: 'pearl-deep', name: 'Pearl Deep', foreground: '#fcfcfb', muted: '#e8e8e6' },
  { id: 'ivory-deep', name: 'Ivory Deep', foreground: '#fffff0', muted: '#f5f5e6' },
  { id: 'cream-deep', name: 'Cream Deep', foreground: '#fffef5', muted: '#f5f0e8' },
  { id: 'frost-text', name: 'Frost', foreground: '#f0faff', muted: '#bae6fd' },
  { id: 'blush-light', name: 'Blush Light', foreground: '#fff5f8', muted: '#fce7ef' },
  { id: 'mint-light', name: 'Mint Light', foreground: '#f0fff8', muted: '#a7f3d0' },
  /* Extra mid */
  { id: 'storm-text', name: 'Storm', foreground: '#4b5563', muted: '#6b7280' },
  { id: 'fog-text', name: 'Fog', foreground: '#9ca3af', muted: '#d1d5db' },
  { id: 'dove-text', name: 'Dove', foreground: '#e5e7eb', muted: '#9ca3af' },
  { id: 'flint-text', name: 'Flint', foreground: '#57534e', muted: '#78716c' },
  { id: 'battleship-text', name: 'Battleship', foreground: '#64748b', muted: '#94a3b8' },
  { id: 'mink-text', name: 'Mink', foreground: '#78716c', muted: '#a8a29e' },
  { id: 'taupe-text', name: 'Taupe', foreground: '#8b7355', muted: '#a88b6a' },
  { id: 'dust-text', name: 'Dust', foreground: '#a8a29e', muted: '#d6d3d1' },

  /* ── Jewel tone texts ───────────────────────────────────── */
  { id: 'sapphire-text', name: 'Sapphire', foreground: '#4d8fd6', muted: '#2a6ab8' },
  { id: 'ruby-text', name: 'Ruby', foreground: '#e04050', muted: '#b03040' },
  { id: 'amethyst-text', name: 'Amethyst', foreground: '#b08ae6', muted: '#8866cc' },
  { id: 'topaz-text', name: 'Topaz', foreground: '#f0c878', muted: '#d4a856' },
  { id: 'emerald-text', name: 'Emerald', foreground: '#50d890', muted: '#30b870' },
  { id: 'garnet-text', name: 'Garnet', foreground: '#c06060', muted: '#944848' },
  { id: 'opal-text', name: 'Opal', foreground: '#c4dbd6', muted: '#8aaba3' },
  { id: 'tanzanite-text', name: 'Tanzanite', foreground: '#8b7ccf', muted: '#6b5aaf' },
  { id: 'citrine-text', name: 'Citrine', foreground: '#e8d840', muted: '#c4b420' },
  { id: 'lapis-text', name: 'Lapis', foreground: '#4a88cc', muted: '#3068a8' },

  /* ── Metallic texts ─────────────────────────────────────── */
  { id: 'champagne-text', name: 'Champagne', foreground: '#f7e7ce', muted: '#d4c4a8' },
  { id: 'brass-text', name: 'Brass', foreground: '#ddb940', muted: '#b89828' },
  { id: 'chrome-text', name: 'Chrome', foreground: '#c8cdd2', muted: '#9aa0a6' },
  { id: 'platinum-text', name: 'Platinum', foreground: '#e5e4e2', muted: '#c0bfbd' },
  { id: 'bronze-metal-text', name: 'Bronze Metal', foreground: '#c0903c', muted: '#987030' },
  { id: 'rose-metal-text', name: 'Rose Metal', foreground: '#d4909a', muted: '#b07078' },

  /* ── Neon texts ─────────────────────────────────────────── */
  { id: 'neon-cyan-text', name: 'Neon Cyan', foreground: '#00fff7', muted: '#00bbbb' },
  { id: 'neon-violet-text', name: 'Neon Violet', foreground: '#d44fff', muted: '#a030cc' },
  { id: 'synthwave-text', name: 'Synthwave', foreground: '#ff5c9a', muted: '#cc3070' },
  { id: 'matrix-text', name: 'Matrix', foreground: '#00ff41', muted: '#00cc33' },
  { id: 'vaporwave-text', name: 'Vaporwave', foreground: '#ff9ddd', muted: '#e070b8' },
  { id: 'plasma-text', name: 'Plasma', foreground: '#ff55ff', muted: '#cc00cc' },

  /* ── Earth texts ────────────────────────────────────────── */
  { id: 'sandstone-text', name: 'Sandstone', foreground: '#d4b890', muted: '#b09870' },
  { id: 'cinnamon-text', name: 'Cinnamon', foreground: '#e89840', muted: '#c07828' },
  { id: 'mahogany-text', name: 'Mahogany', foreground: '#e06040', muted: '#b84830' },
  { id: 'driftwood-text', name: 'Driftwood', foreground: '#c0a888', muted: '#9a8868' },
  { id: 'wheat-text', name: 'Wheat', foreground: '#e4bc72', muted: '#c09c50' },
  { id: 'ochre-text', name: 'Ochre', foreground: '#e09838', muted: '#b87820' },
  ...EXPANDED_THEME_WRITING_COLOURS,
];

/** Display order: sections for writing (text) colours. */
export const THEME_WRITING_SECTIONS = [
  { label: 'Default & light', ids: ['default', 'snow', 'pearl', 'ivory-text', 'cream-text', 'warm-white', 'cool-white', 'bone', 'eggshell', 'linen', 'vanilla', 'honeydew', 'azure', 'alabaster', 'chalk', 'milk', 'silk-text', 'snow-deep', 'linen-text', 'pearl-deep', 'ivory-deep', 'cream-deep', 'frost-text', 'blush-light', 'mint-light'] },
  { label: 'Grays', ids: ['gray-50', 'gray-100', 'gray-200', 'gray-300', 'gray-400', 'gray-500', 'zinc-100', 'zinc-200', 'zinc-300', 'zinc-400', 'zinc-500', 'slate-200', 'slate-300', 'slate-400', 'slate-500', 'stone-200', 'stone-300', 'stone-400', 'neutral-300', 'neutral-400', 'storm-text', 'fog-text', 'dove-text', 'flint-text', 'battleship-text', 'mink-text', 'taupe-text', 'dust-text'] },
  { label: 'Dark', ids: ['charcoal-text', 'graphite-text', 'smoke-text', 'carbon-text', 'obsidian-text', 'ink', 'midnight-text', 'iron', 'lead', 'ash-dark', 'graphite-dark', 'slate-dark', 'navy-text', 'forest-text', 'burgundy-text', 'plum-dark', 'dark-1', 'dark-2', 'dark-3', 'dark-charcoal', 'dark-brown-grey', 'dark-indigo', 'dark-blue', 'dark-purple', 'dark-maroon', 'dark-forest', 'dark-teal', 'dark-slate', 'shadow', 'onyx', 'ink-deep', 'pitch-text', 'obsidian-deep', 'midnight-ink', 'forest-ink', 'wine-ink', 'plum-ink', 'slate-ink', 'teal-ink', 'carbon-deep'] },
  { label: 'Tinted – warm', ids: ['warm-gray', 'sepia-text', 'parchment', 'amber-text', 'saffron-text', 'butter', 'wheat', 'sand', 'caramel', 'toast', 'terracotta-text', 'clay'] },
  { label: 'Tinted – cool', ids: ['cool-gray', 'blue-gray', 'frost', 'ice', 'mist', 'steel-text', 'silver-text'] },
  { label: 'Tinted – pastels', ids: ['blush-text', 'rose-text', 'pink-text', 'lavender-text', 'lilac', 'violet-text', 'mauve', 'mint-text', 'sage-text', 'seafoam', 'aqua-text', 'sky-text', 'powder-blue', 'periwinkle-text'] },
  { label: 'Stronger tints', ids: ['gold-text', 'cream-gold', 'peach-text', 'coral-text', 'salmon', 'melon', 'lavender-rose-text', 'thistle', 'eucalyptus', 'spearmint', 'turquoise-text', 'arctic', 'cornflower', 'bluebell'] },
  { label: 'More lights', ids: ['pure-white', 'bright-white', 'paper', 'off-white', 'light-1', 'light-2', 'light-3', 'pearl-light', 'snow-light', 'cloud'] },
  { label: 'Vibrant', ids: ['neon-orange', 'neon-orange-light', 'hot-pink', 'hot-pink-light', 'royal-blue', 'royal-blue-light', 'bright-green', 'bright-green-light', 'bright-yellow', 'bright-yellow-light', 'burnt-orange', 'deep-red', 'vibrant-cyan', 'vibrant-purple', 'vibrant-rose', 'electric-blue'] },
  { label: 'Pastel lights', ids: ['pastel-orange', 'pastel-yellow', 'pastel-pink-light', 'pastel-blue-light', 'pastel-green-light', 'pastel-lavender', 'pastel-mint', 'pastel-sky', 'pastel-peach', 'pastel-rose'] },
  { label: 'Mid greys', ids: ['grey-150', 'grey-250', 'grey-350', 'grey-450', 'grey-550', 'grey-650', 'grey-750', 'grey-850'] },
  { label: 'Jewel tones', ids: ['sapphire-text', 'ruby-text', 'amethyst-text', 'topaz-text', 'emerald-text', 'garnet-text', 'opal-text', 'tanzanite-text', 'citrine-text', 'lapis-text'] },
  { label: 'Metallics', ids: ['champagne-text', 'brass-text', 'chrome-text', 'platinum-text', 'bronze-metal-text', 'rose-metal-text'] },
  { label: 'Neon & cyber', ids: ['neon-cyan-text', 'neon-violet-text', 'synthwave-text', 'matrix-text', 'vaporwave-text', 'plasma-text'] },
  { label: 'Earth & nature', ids: ['sandstone-text', 'cinnamon-text', 'mahogany-text', 'driftwood-text', 'wheat-text', 'ochre-text'] },
  EXPANDED_WRITING_SECTION,
];

export const DEFAULT_COLOUR_ID = 'sky';
/** Default button colour matches site accent (sky). Gold olive buttons remain available as dark-gold. */
export const DEFAULT_BUTTON_COLOUR_ID = 'sky';
export const DEFAULT_WRITING_COLOUR_ID = 'default';
export const DEFAULT_TEXT_STYLE_ID = 'normal';
export const DEFAULT_FONT_ID = 'clean';
export const DEFAULT_BUTTON_STYLE_ID = 'original';
export const DEFAULT_TEXTURE_ID = 'none';
export const DEFAULT_THEME_VARIANT = 'classic';
export const DEFAULT_BUTTON_SHAPE_ID = 'rounded';
export const THEME_VARIANTS = [
  { id: 'classic', name: 'Classic Layout', description: 'Original mafia layout and spacing' },
  { id: 'modern', name: 'Modern Layout', description: 'Futuristic layout with modern spacing and sections' },
  { id: 'dark_mafia', name: 'Dark Mafia Wars', description: 'Command-center chrome — near-black panels, accent rail, dense layout' },
  { id: 'old_school', name: 'Old School Mafia', description: 'Early browser-game chrome — navy canvas, gray boxes, deep-blue bars' },
];

/** Normalize stored / API themeVariant to a known layout id. */
export function normalizeThemeVariant(variant) {
  if (variant === 'modern' || variant === 'dark_mafia' || variant === 'wars2026' || variant === 'old_school') {
    // wars2026 was an early id; treat as Dark Mafia Wars
    return variant === 'wars2026' ? 'dark_mafia' : variant;
  }
  return 'classic';
}

/** Mobile-only shell layouts (≤767px). Orthogonal to themeVariant colours/chrome. */
export const DEFAULT_MOBILE_LAYOUT_ID = 'classic';
export const THEME_MOBILE_LAYOUTS = [
  {
    id: 'classic',
    name: 'Classic Mobile',
    description: 'Current phone chrome — sidebar or bottom bar, plus your chosen stats placement',
  },
  {
    id: 'pocket_deck',
    name: 'Pocket Deck',
    description: 'Phone HUD: thin status strip, 5-slot dock, and a full menu sheet',
  },
];

/** Normalize stored / API mobileLayoutId. */
export function normalizeMobileLayoutId(id) {
  return id === 'pocket_deck' ? 'pocket_deck' : 'classic';
}

/** First-time / Reset Classic & Reset Modern / Dark Mafia targets. */
export const THEME_RESET_CLASSIC_ID = 'default';
export const THEME_RESET_MODERN_ID = 'modern-full';
export const THEME_RESET_DARK_MAFIA_ID = 'dark-mafia-wars';

/** Pinned “Starting looks” row in Theme Studio (handcrafted + hero presets). */
export const STARTING_LOOK_PRESET_IDS = [
  'old-default',
  'old-school-mafia-theme',
  'modern-full',
  'dark-mafia-wars',
  'noir-contrast-full',
  'crimson-mafia-full',
  'clean-steel-full',
  'gold-classic-full',
  'blood-red-full',
  'midnight-blue-full',
];

/** Layout / chrome defaults restored by full theme reset (alongside preset fields). */
export const THEME_LAYOUT_RESET_DEFAULTS = {
  topBarGap: 'normal',
  topBarSize: 'medium',
  topBarChipWidthScale: 50,
  topBarChipHeightScale: 50,
  sidebarShowDividers: false,
  bottomNavShowDividers: false,
  sidebarDividerStyle: 'solid',
  sidebarSpacing: 'normal',
  toastPosition: 'bottom-center',
  toastCloseButton: true,
  killToastStyle: 'popup',
  buttonShapeId: DEFAULT_BUTTON_SHAPE_ID,
};

/** Extra layout defaults applied when resetting to Old School Mafia Theme. */
export const THEME_LAYOUT_RESET_OLD_SCHOOL = {
  ...THEME_LAYOUT_RESET_DEFAULTS,
  topBarGap: 'compact',
  topBarSize: 'small',
  sidebarShowDividers: true,
  sidebarDividerStyle: 'solid',
  sidebarSpacing: 'compact',
  buttonShapeId: 'sharp',
};

/**
 * Full presets: one-click theme bundles (colour + texture + optional button/accent/writing/buttonStyle).
 * buttonColourId / accentLineColourId: null = use main colour.
 * Optional: writingColourId, mutedWritingColourId, buttonStyleId, fontId, textStyleId, toastTextColourId for full presets.
 */
export const THEME_PRESETS = [
  { id: 'old-default', name: 'Old Default Theme', description: 'Full theme: gold accent, no texture, original buttons, default text & font', colourId: 'gold', textureId: 'none', buttonColourId: null, accentLineColourId: null, writingColourId: 'default', mutedWritingColourId: null, buttonStyleId: 'original', fontId: 'classic', textStyleId: 'normal', toastTextColourId: null, mobileNavStyle: 'bottom', mobileStatsDisplay: 'right_sidebar', sidebarLayout: 'categorized_classic', themeVariant: 'classic', buttonShapeId: 'rounded', isFullPreset: true },
  { id: 'old-school-mafia-theme', name: 'Old School Mafia Theme', description: 'Early browser-game look: navy patterned canvas, gray boxed panels, deep-blue section bars, compact type', colourId: 'obsidian-blue', textureId: 'crosshatch', buttonColourId: 'deep-navy', accentLineColourId: 'obsidian-blue', writingColourId: 'cool-white', mutedWritingColourId: 'slate-300', buttonStyleId: 'flat', fontId: 'compact', textStyleId: 'normal', toastTextColourId: 'cool-white', mobileNavStyle: 'bottom', mobileStatsDisplay: 'right_sidebar', sidebarLayout: 'categorized_classic', themeVariant: 'old_school', buttonShapeId: 'sharp', isFullPreset: true, presetCategory: 'mafia' },
  { id: 'modern-full', name: 'Modern Full', description: 'Modern layout with the Telegram sky-blue accent, cleaner typography and spacing', colourId: 'sky', textureId: 'modern-soft', buttonColourId: null, accentLineColourId: null, writingColourId: 'steel-text', mutedWritingColourId: 'slate-300', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'steel-text', mobileNavStyle: 'bottom', mobileStatsDisplay: 'right_sidebar', sidebarLayout: 'categorized_classic', themeVariant: 'modern', buttonShapeId: 'rounded', isFullPreset: true },
  { id: 'dark-mafia-wars', name: 'Dark Mafia Wars', description: 'Command-center chrome: near-black panels, sky accent rail, dense layout', colourId: 'sky', textureId: 'none', buttonColourId: 'sky', accentLineColourId: 'sky', writingColourId: 'cool-white', mutedWritingColourId: 'slate-300', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'cool-white', mobileNavStyle: 'bottom', mobileStatsDisplay: 'right_sidebar', sidebarLayout: 'categorized_classic', themeVariant: 'dark_mafia', buttonShapeId: 'sharp', isFullPreset: true },
  { id: 'noir-contrast-full', name: 'High Contrast Noir', description: 'Charcoal + gold buttons, carbon texture, sharp industrial type', colourId: 'charcoal', textureId: 'carbon', buttonColourId: 'dark-gold', accentLineColourId: 'gold', writingColourId: 'snow', mutedWritingColourId: 'zinc-400', buttonStyleId: 'outline', fontId: 'industrial', textStyleId: 'medium', toastTextColourId: 'snow', mobileNavStyle: 'bottom', mobileStatsDisplay: 'right_sidebar', sidebarLayout: 'categorized_classic', themeVariant: 'classic', buttonShapeId: 'sharp', isFullPreset: true, presetCategory: 'dark-pro' },
  { id: 'crimson-mafia-full', name: 'Crimson Mafia', description: 'Deep blood accent, warm parchment text, grain texture', colourId: 'blood', textureId: 'grain', buttonColourId: null, accentLineColourId: null, writingColourId: 'parchment', mutedWritingColourId: 'warm-gray', buttonStyleId: 'shaded', fontId: 'elegant', textStyleId: 'semibold', toastTextColourId: 'parchment', mobileNavStyle: 'bottom', mobileStatsDisplay: 'right_sidebar', sidebarLayout: 'categorized', themeVariant: 'classic', buttonShapeId: 'rounded', isFullPreset: true, presetCategory: 'dark-pro' },
  { id: 'clean-steel-full', name: 'Clean Steel', description: 'Cool steel accent, modern layout, mesh texture', colourId: 'steel', textureId: 'mesh', buttonColourId: null, accentLineColourId: null, writingColourId: 'cool-white', mutedWritingColourId: 'slate-300', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'cool-white', mobileNavStyle: 'bottom', mobileStatsDisplay: 'right_sidebar', sidebarLayout: 'categorized_classic', themeVariant: 'modern', buttonShapeId: 'rounded', isFullPreset: true, presetCategory: 'metallic' },
  { id: 'original', name: 'Original theme', description: 'Default look before custom themes', colourId: 'gold', textureId: 'none', buttonColourId: null, accentLineColourId: null, themeVariant: 'classic' },
  { id: 'default', name: 'Default', description: 'Sky blue accent (site default)', colourId: 'sky', textureId: 'none', buttonColourId: 'sky', accentLineColourId: null },
  { id: 'classic-gold', name: 'Classic Gold', description: 'Original gold accent', colourId: 'gold', textureId: 'none', buttonColourId: 'dark-gold', accentLineColourId: null },
  { id: 'dark-mode', name: 'Dark Mode', description: 'Slate accents, clean', colourId: 'matte-slate', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'telegram', name: 'Telegram', description: 'Teal / sky blue', colourId: 'sky', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'facebook', name: 'Facebook', description: 'Blue accent', colourId: 'blue', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'glossy-gold', name: 'Glossy Gold', description: 'Rich gold', colourId: 'glossy-gold', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'glossy-teal', name: 'Glossy Teal', description: 'Shiny teal', colourId: 'glossy-teal', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'matte', name: 'Matte', description: 'Muted, flat look', colourId: 'matte-sage', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'midnight', name: 'Midnight', description: 'Deep blue / indigo', colourId: 'midnight', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'ocean', name: 'Ocean', description: 'Blue → teal gradient', colourId: 'tone-2-ocean', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'forest', name: 'Forest', description: 'Green tones', colourId: 'tone-2-forest', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'rose-gold', name: 'Rose Gold', description: 'Warm rose gold', colourId: 'rose-gold', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'ember', name: 'Ember', description: 'Dark red / orange', colourId: 'tone-4-ember', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'lavender-dream', name: 'Lavender Dream', description: 'Soft purple gradient', colourId: 'tone-3-lavender', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'noir-matte', name: 'Noir Matte', description: 'Charcoal, minimal', colourId: 'charcoal', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'vintage-paper', name: 'Vintage Paper', description: 'Sepia', colourId: 'sepia', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'carbon-pro', name: 'Carbon Pro', description: 'Dark carbon', colourId: 'carbon', textureId: 'none', buttonColourId: null, accentLineColourId: null },

  /* Mafia vibes */
  { id: 'old-school-mafia', name: 'Old School Mafia', description: '1920s gold', colourId: 'gold', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'old-school-mafia-noir', name: 'Old School Mafia Noir', description: 'Film noir, charcoal + gold', colourId: 'charcoal', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'modern-mafia', name: 'Modern Mafia', description: 'Clean slate blue', colourId: 'matte-slate', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'speakeasy', name: 'Speakeasy', description: 'Warm bronze', colourId: 'bronze', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'godfather', name: 'The Godfather', description: 'Deep amber', colourId: 'antique-brass', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'street-boss', name: 'Street Boss', description: 'Gunmetal + gold accent', colourId: 'gunmetal', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'sicilian', name: 'Sicilian', description: 'Terracotta warmth', colourId: 'terracotta', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'boardroom', name: 'Boardroom', description: 'Navy, minimal', colourId: 'navy', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'noir-gold', name: 'Noir Gold', description: 'Black & gold classic', colourId: 'gold', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'vintage-noir', name: 'Vintage Noir', description: 'Sepia noir', colourId: 'sepia', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'concrete-boss', name: 'Concrete Boss', description: 'Steel', colourId: 'steel', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'blood-money', name: 'Blood & Money', description: 'Wine red, dark', colourId: 'wine', textureId: 'none', buttonColourId: null, accentLineColourId: null },

  /* Full multicolored presets (accent + writing + buttons coordinated) */
  { id: 'neon-pink-full', name: 'Neon Pink', description: 'Pink accent, blush text, glossy', colourId: 'neon-pink', textureId: 'none', buttonColourId: null, accentLineColourId: null, writingColourId: 'blush-text', mutedWritingColourId: 'hot-pink-light', buttonStyleId: 'glossy', toastTextColourId: 'blush-text', isFullPreset: true },
  { id: 'ocean-full', name: 'Ocean Blue', description: 'Teal accent, sky text, glossy', colourId: 'teal', textureId: 'none', buttonColourId: null, accentLineColourId: null, writingColourId: 'sky-text', mutedWritingColourId: 'aqua-text', buttonStyleId: 'glossy', toastTextColourId: 'sky-text', isFullPreset: true },
  { id: 'forest-full', name: 'Forest Green', description: 'Green accent, mint text, flat', colourId: 'emerald', textureId: 'none', buttonColourId: null, accentLineColourId: null, writingColourId: 'mint-text', mutedWritingColourId: 'sage-text', buttonStyleId: 'flat', toastTextColourId: 'mint-text', isFullPreset: true },
  { id: 'sunset-full', name: 'Sunset', description: 'Orange accent, peach text, shaded', colourId: 'sunset', textureId: 'none', buttonColourId: null, accentLineColourId: null, writingColourId: 'peach-text', mutedWritingColourId: 'melon', buttonStyleId: 'shaded', toastTextColourId: 'peach-text', isFullPreset: true },
  { id: 'lavender-full', name: 'Lavender Dream', description: 'Purple accent, lavender text, glossy', colourId: 'lavender', textureId: 'none', buttonColourId: null, accentLineColourId: null, writingColourId: 'lavender-text', mutedWritingColourId: 'lilac', buttonStyleId: 'glossy', toastTextColourId: 'lavender-text', isFullPreset: true },
  { id: 'gold-classic-full', name: 'Gold Classic', description: 'Gold accent, cream-gold text, raised', colourId: 'gold', textureId: 'none', buttonColourId: null, accentLineColourId: null, writingColourId: 'cream-gold', mutedWritingColourId: 'warm-white', buttonStyleId: 'raised', toastTextColourId: 'cream-gold', isFullPreset: true },
  { id: 'coral-full', name: 'Coral', description: 'Coral accent, peach text, glossy', colourId: 'coral', textureId: 'none', buttonColourId: null, accentLineColourId: null, writingColourId: 'coral-text', mutedWritingColourId: 'salmon', buttonStyleId: 'glossy', toastTextColourId: 'coral-text', isFullPreset: true },
  { id: 'electric-blue-full', name: 'Electric Blue', description: 'Blue accent, cool white text, glossy', colourId: 'electric', textureId: 'none', buttonColourId: null, accentLineColourId: null, writingColourId: 'cool-white', mutedWritingColourId: 'powder-blue', buttonStyleId: 'glossy', toastTextColourId: 'cool-white', isFullPreset: true },
  { id: 'neon-green-full', name: 'Neon Green', description: 'Green accent, mint text, flat', colourId: 'neon-green', textureId: 'none', buttonColourId: null, accentLineColourId: null, writingColourId: 'eucalyptus', mutedWritingColourId: 'spearmint', buttonStyleId: 'flat', toastTextColourId: 'eucalyptus', isFullPreset: true },
  { id: 'royal-purple-full', name: 'Royal Purple', description: 'Violet accent, periwinkle text, shadow', colourId: 'violet', textureId: 'none', buttonColourId: null, accentLineColourId: null, writingColourId: 'periwinkle-text', mutedWritingColourId: 'lavender-text', buttonStyleId: 'shadow', toastTextColourId: 'periwinkle-text', isFullPreset: true },
  { id: 'blood-red-full', name: 'Blood Red', description: 'Deep red accent, warm text, shaded', colourId: 'blood', textureId: 'none', buttonColourId: null, accentLineColourId: null, writingColourId: 'burgundy-text', mutedWritingColourId: null, buttonStyleId: 'shaded', toastTextColourId: 'burgundy-text', isFullPreset: true },
  { id: 'cyan-full', name: 'Cyan', description: 'Cyan accent, seafoam text, glossy', colourId: 'cyan', textureId: 'none', buttonColourId: null, accentLineColourId: null, writingColourId: 'seafoam', mutedWritingColourId: 'aqua-text', buttonStyleId: 'glossy', toastTextColourId: 'seafoam', isFullPreset: true },

  /* Additional full presets (~15 more) */
  { id: 'amber-glow-full', name: 'Amber Glow', description: 'Amber accent, cream-gold text, raised', colourId: 'amber', textureId: 'none', buttonColourId: null, accentLineColourId: null, writingColourId: 'cream-gold', mutedWritingColourId: 'warm-white', buttonStyleId: 'raised', toastTextColourId: 'cream-gold', isFullPreset: true },
  { id: 'rose-gold-full', name: 'Rose Gold', description: 'Rose gold accent, blush text, glossy', colourId: 'rose-gold', textureId: 'none', buttonColourId: null, accentLineColourId: null, writingColourId: 'blush-text', mutedWritingColourId: 'coral-text', buttonStyleId: 'glossy', toastTextColourId: 'blush-text', isFullPreset: true },
  { id: 'midnight-blue-full', name: 'Midnight Blue', description: 'Deep indigo accent, cool white text, shadow', colourId: 'midnight', textureId: 'none', buttonColourId: null, accentLineColourId: null, writingColourId: 'cool-white', mutedWritingColourId: 'powder-blue', buttonStyleId: 'shadow', toastTextColourId: 'cool-white', isFullPreset: true },
  { id: 'jade-garden-full', name: 'Jade Garden', description: 'Jade accent, mint text, flat', colourId: 'jade', textureId: 'none', buttonColourId: null, accentLineColourId: null, writingColourId: 'mint-text', mutedWritingColourId: 'sage-text', buttonStyleId: 'flat', toastTextColourId: 'mint-text', isFullPreset: true },
  { id: 'honeycomb-full', name: 'Honeycomb', description: 'Honey accent, vanilla text, shaded', colourId: 'honey', textureId: 'none', buttonColourId: null, accentLineColourId: null, writingColourId: 'vanilla', mutedWritingColourId: 'cream-gold', buttonStyleId: 'shaded', toastTextColourId: 'vanilla', isFullPreset: true },
  { id: 'peach-smoothie-full', name: 'Peach Smoothie', description: 'Peach accent, peach text, glossy', colourId: 'peach', textureId: 'none', buttonColourId: null, accentLineColourId: null, writingColourId: 'peach-text', mutedWritingColourId: 'melon', buttonStyleId: 'glossy', toastTextColourId: 'peach-text', isFullPreset: true },
  { id: 'indigo-night-full', name: 'Indigo Night', description: 'Indigo accent, periwinkle text, shadow', colourId: 'indigo', textureId: 'none', buttonColourId: null, accentLineColourId: null, writingColourId: 'periwinkle-text', mutedWritingColourId: 'lavender-text', buttonStyleId: 'shadow', toastTextColourId: 'periwinkle-text', isFullPreset: true },
  { id: 'saffron-full', name: 'Saffron', description: 'Saffron accent, cream-gold text, opaque', colourId: 'saffron', textureId: 'none', buttonColourId: null, accentLineColourId: null, writingColourId: 'cream-gold', mutedWritingColourId: 'warm-white', buttonStyleId: 'opaque', toastTextColourId: 'cream-gold', isFullPreset: true },
  { id: 'pastel-pink-full', name: 'Pastel Pink', description: 'Pastel pink accent, blush text, glossy', colourId: 'pastel-pink', textureId: 'none', buttonColourId: null, accentLineColourId: null, writingColourId: 'blush-text', mutedWritingColourId: 'lavender-rose-text', buttonStyleId: 'glossy', toastTextColourId: 'blush-text', isFullPreset: true },
  { id: 'deep-ocean-full', name: 'Deep Ocean', description: 'Navy accent, sky text, flat', colourId: 'navy', textureId: 'none', buttonColourId: null, accentLineColourId: null, writingColourId: 'sky-text', mutedWritingColourId: 'powder-blue', buttonStyleId: 'flat', toastTextColourId: 'sky-text', isFullPreset: true },
  { id: 'dusty-rose-full', name: 'Dusty Rose', description: 'Dusty rose accent, coral text, shaded', colourId: 'dusty-rose', textureId: 'none', buttonColourId: null, accentLineColourId: null, writingColourId: 'coral-text', mutedWritingColourId: 'blush-text', buttonStyleId: 'shaded', toastTextColourId: 'coral-text', isFullPreset: true },
  { id: 'sea-green-full', name: 'Sea Green', description: 'Sea green accent, seafoam text, glossy', colourId: 'sea-green', textureId: 'none', buttonColourId: null, accentLineColourId: null, writingColourId: 'seafoam', mutedWritingColourId: 'aqua-text', buttonStyleId: 'glossy', toastTextColourId: 'seafoam', isFullPreset: true },
  { id: 'twilight-full', name: 'Twilight', description: 'Twilight purple accent, lavender text, shadow', colourId: 'twilight', textureId: 'none', buttonColourId: null, accentLineColourId: null, writingColourId: 'lavender-text', mutedWritingColourId: 'lilac', buttonStyleId: 'shadow', toastTextColourId: 'lavender-text', isFullPreset: true },
  { id: 'amber-copper-full', name: 'Amber Copper', description: 'Amber copper accent, peach text, raised', colourId: 'amber-copper', textureId: 'none', buttonColourId: null, accentLineColourId: null, writingColourId: 'peach-text', mutedWritingColourId: 'melon', buttonStyleId: 'raised', toastTextColourId: 'peach-text', isFullPreset: true },
  { id: 'muted-teal-full', name: 'Muted Teal', description: 'Muted teal accent, aqua text, flat', colourId: 'muted-teal', textureId: 'none', buttonColourId: null, accentLineColourId: null, writingColourId: 'aqua-text', mutedWritingColourId: 'seafoam', buttonStyleId: 'flat', toastTextColourId: 'aqua-text', isFullPreset: true },
  { id: 'pastel-mint-full', name: 'Pastel Mint', description: 'Pastel green accent, mint text, glossy', colourId: 'pastel-green', textureId: 'none', buttonColourId: null, accentLineColourId: null, writingColourId: 'mint-text', mutedWritingColourId: 'eucalyptus', buttonStyleId: 'glossy', toastTextColourId: 'mint-text', isFullPreset: true },
  { id: 'rust-full', name: 'Rust', description: 'Rust accent, peach text, shaded', colourId: 'rust', textureId: 'none', buttonColourId: null, accentLineColourId: null, writingColourId: 'peach-text', mutedWritingColourId: 'coral-text', buttonStyleId: 'shaded', toastTextColourId: 'peach-text', isFullPreset: true },
  { id: 'royal-blue-full', name: 'Royal Blue', description: 'Royal blue accent, periwinkle text, shadow', colourId: 'royal', textureId: 'none', buttonColourId: null, accentLineColourId: null, writingColourId: 'periwinkle-text', mutedWritingColourId: 'powder-blue', buttonStyleId: 'shadow', toastTextColourId: 'periwinkle-text', isFullPreset: true },

  /* 20 more one-click presets */
  { id: 'crimson-velvet', name: 'Crimson Velvet', description: 'Deep crimson accent', colourId: 'crimson', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'fuchsia-pop', name: 'Fuchsia Pop', description: 'Vivid fuchsia', colourId: 'fuchsia', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'indigo-night', name: 'Indigo Night', description: 'Rich indigo', colourId: 'indigo', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'lime-zest', name: 'Lime Zest', description: 'Bright lime green', colourId: 'lime', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'aurora-full', name: 'Aurora', description: 'Green, cyan & purple gradient', colourId: 'tone-3-aurora', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'candy-full', name: 'Candy', description: 'Sweet pink gradient', colourId: 'tone-4-candy', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'neon-grid', name: 'Neon Grid', description: 'Cyan to pink neon gradient', colourId: 'tone-4-neon', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'ice-cave', name: 'Ice Cave', description: 'Cool blue gradient', colourId: 'tone-4-ice', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'wine-bar', name: 'Wine Bar', description: 'Deep purple gradient', colourId: 'tone-4-wine', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'raspberry-full', name: 'Raspberry', description: 'Dark red to orange', colourId: 'tone-3-raspberry', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'fire-glow', name: 'Fire Glow', description: 'Red, orange, yellow', colourId: 'tone-3-fire', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'rainbow-full', name: 'Rainbow', description: 'Four-tone rainbow', colourId: 'tone-4-rainbow', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'peach-sorbet', name: 'Peach Sorbet', description: 'Soft peach accent', colourId: 'peach', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'mint-fresh', name: 'Mint Fresh', description: 'Cool mint green', colourId: 'mint', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'coral-reef', name: 'Coral Reef', description: 'Coral pink accent', colourId: 'coral', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'honeycomb-simple', name: 'Honeycomb', description: 'Warm honey gold', colourId: 'honey', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'tangerine-full', name: 'Tangerine', description: 'Bright tangerine', colourId: 'tangerine', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'lagoon-full', name: 'Lagoon', description: 'Teal lagoon', colourId: 'lagoon', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'mulberry-full', name: 'Mulberry', description: 'Deep mulberry', colourId: 'mulberry', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'steel-professional', name: 'Steel Professional', description: 'Steel blue, clean', colourId: 'steel-blue', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'moss-full', name: 'Moss', description: 'Earthy moss green', colourId: 'moss', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'thistle-full', name: 'Thistle', description: 'Soft purple thistle', colourId: 'thistle', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'apricot-full', name: 'Apricot', description: 'Warm apricot', colourId: 'apricot', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'camel-full', name: 'Camel', description: 'Neutral camel', colourId: 'camel', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'frost-morning', name: 'Frost Morning', description: 'Cool frost blue', colourId: 'frost-blue', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'blue-orange-gradient', name: 'Blue Orange', description: 'Blue to orange gradient', colourId: 'gradient-blue-orange', textureId: 'none', buttonColourId: null, accentLineColourId: null },
  { id: 'peach-pink-gradient', name: 'Peach Pink', description: 'Peach to pink gradient', colourId: 'gradient-peach-pink', textureId: 'none', buttonColourId: null, accentLineColourId: null },

  /* 50 Modern full presets – futuristic layout + modern-soft texture */
  { id: 'modern-slate', name: 'Modern Slate', description: 'Neutral gray, flat', colourId: 'matte-slate', textureId: 'modern-soft', buttonColourId: 'steel', accentLineColourId: 'slate', writingColourId: 'steel-text', mutedWritingColourId: 'zinc-400', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'steel-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-teal', name: 'Modern Teal', description: 'Teal accent, aqua text', colourId: 'teal', textureId: 'modern-soft', buttonColourId: 'jade', accentLineColourId: 'teal', writingColourId: 'aqua-text', mutedWritingColourId: 'seafoam', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'aqua-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-emerald', name: 'Modern Emerald', description: 'Emerald, mint text', colourId: 'emerald', textureId: 'modern-soft', buttonColourId: 'jade', accentLineColourId: 'emerald', writingColourId: 'mint-text', mutedWritingColourId: 'sage-text', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'mint-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-violet', name: 'Modern Violet', description: 'Violet, lavender text', colourId: 'violet', textureId: 'modern-soft', buttonColourId: 'lavender', accentLineColourId: 'indigo', writingColourId: 'lavender-text', mutedWritingColourId: 'lilac', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'lavender-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-amber', name: 'Modern Amber', description: 'Amber, cream-gold text', colourId: 'amber', textureId: 'modern-soft', buttonColourId: 'saffron', accentLineColourId: 'amber', writingColourId: 'cream-gold', mutedWritingColourId: 'warm-white', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'cream-gold', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-coral', name: 'Modern Coral', description: 'Coral, peach text', colourId: 'coral', textureId: 'modern-soft', buttonColourId: 'coral-pink', accentLineColourId: 'coral', writingColourId: 'coral-text', mutedWritingColourId: 'salmon', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'coral-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-cyan', name: 'Modern Cyan', description: 'Cyan, seafoam text', colourId: 'cyan', textureId: 'modern-soft', buttonColourId: 'aqua', accentLineColourId: 'teal', writingColourId: 'seafoam', mutedWritingColourId: 'aqua-text', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'seafoam', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-rose-gold', name: 'Modern Rose Gold', description: 'Rose gold, blush text', colourId: 'rose-gold', textureId: 'modern-soft', buttonColourId: 'lavender-rose', accentLineColourId: 'rose-gold', writingColourId: 'blush-text', mutedWritingColourId: 'coral-text', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'blush-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-indigo', name: 'Modern Indigo', description: 'Indigo, periwinkle text', colourId: 'indigo', textureId: 'modern-soft', buttonColourId: 'violet', accentLineColourId: 'indigo', writingColourId: 'periwinkle-text', mutedWritingColourId: 'lavender-text', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'periwinkle-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-graphite', name: 'Modern Graphite', description: 'Graphite, silver text', colourId: 'graphite', textureId: 'modern-soft', buttonColourId: 'charcoal', accentLineColourId: 'carbon', writingColourId: 'silver-text', mutedWritingColourId: 'zinc-400', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'silver-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-electric', name: 'Modern Electric', description: 'Electric blue, cool white', colourId: 'electric', textureId: 'modern-soft', buttonColourId: 'blue', accentLineColourId: 'electric', writingColourId: 'cool-white', mutedWritingColourId: 'powder-blue', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'cool-white', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-neon-pink', name: 'Modern Neon Pink', description: 'Neon pink, blush text', colourId: 'neon-pink', textureId: 'modern-soft', buttonColourId: 'fuchsia', accentLineColourId: 'neon-pink', writingColourId: 'blush-text', mutedWritingColourId: 'lavender-rose-text', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'blush-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-neon-green', name: 'Modern Neon Green', description: 'Neon green, mint text', colourId: 'neon-green', textureId: 'modern-soft', buttonColourId: 'emerald', accentLineColourId: 'mint', writingColourId: 'eucalyptus', mutedWritingColourId: 'spearmint', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'eucalyptus', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-midnight', name: 'Modern Midnight', description: 'Deep indigo, cool white', colourId: 'midnight', textureId: 'modern-soft', buttonColourId: 'indigo', accentLineColourId: 'midnight', writingColourId: 'cool-white', mutedWritingColourId: 'powder-blue', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'cool-white', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-charcoal', name: 'Modern Charcoal', description: 'Charcoal, zinc text', colourId: 'charcoal', textureId: 'modern-soft', buttonColourId: 'graphite', accentLineColourId: 'carbon', writingColourId: 'zinc-200', mutedWritingColourId: 'zinc-400', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'zinc-200', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-sunset', name: 'Modern Sunset', description: 'Sunset orange, peach text', colourId: 'sunset', textureId: 'modern-soft', buttonColourId: 'orange', accentLineColourId: 'sunset', writingColourId: 'peach-text', mutedWritingColourId: 'melon', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'peach-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-twilight', name: 'Modern Twilight', description: 'Twilight purple, lavender text', colourId: 'twilight', textureId: 'modern-soft', buttonColourId: 'violet', accentLineColourId: 'twilight', writingColourId: 'lavender-text', mutedWritingColourId: 'lilac', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'lavender-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-gunmetal', name: 'Modern Gunmetal', description: 'Gunmetal, steel text', colourId: 'gunmetal', textureId: 'modern-soft', buttonColourId: 'steel', accentLineColourId: 'charcoal', writingColourId: 'steel-text', mutedWritingColourId: 'zinc-400', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'steel-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-sage', name: 'Modern Sage', description: 'Sage green, mint text', colourId: 'sage', textureId: 'modern-soft', buttonColourId: 'emerald', accentLineColourId: 'sage', writingColourId: 'sage-text', mutedWritingColourId: 'mint-text', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'sage-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-crimson', name: 'Modern Crimson', description: 'Crimson, burgundy text', colourId: 'crimson', textureId: 'modern-soft', buttonColourId: 'blood', accentLineColourId: 'crimson', writingColourId: 'burgundy-text', mutedWritingColourId: 'rose-text', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'burgundy-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-lagoon', name: 'Modern Lagoon', description: 'Lagoon teal, seafoam text', colourId: 'lagoon', textureId: 'modern-soft', buttonColourId: 'teal', accentLineColourId: 'jade', writingColourId: 'seafoam', mutedWritingColourId: 'aqua-text', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'seafoam', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-fuchsia', name: 'Modern Fuchsia', description: 'Fuchsia, blush text', colourId: 'fuchsia', textureId: 'modern-soft', buttonColourId: 'magenta', accentLineColourId: 'fuchsia', writingColourId: 'blush-text', mutedWritingColourId: 'pink-text', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'blush-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-wine', name: 'Modern Wine', description: 'Wine red, burgundy text', colourId: 'wine', textureId: 'modern-soft', buttonColourId: 'blood', accentLineColourId: 'wine', writingColourId: 'burgundy-text', mutedWritingColourId: null, buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'burgundy-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-royal', name: 'Modern Royal', description: 'Royal blue, periwinkle text', colourId: 'royal', textureId: 'modern-soft', buttonColourId: 'indigo', accentLineColourId: 'royal', writingColourId: 'periwinkle-text', mutedWritingColourId: 'powder-blue', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'periwinkle-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-navy', name: 'Modern Navy', description: 'Navy, sky text', colourId: 'navy', textureId: 'modern-soft', buttonColourId: 'deep-blue', accentLineColourId: 'navy', writingColourId: 'sky-text', mutedWritingColourId: 'powder-blue', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'sky-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-moss', name: 'Modern Moss', description: 'Moss green, sage text', colourId: 'moss', textureId: 'modern-soft', buttonColourId: 'forest', accentLineColourId: 'sage', writingColourId: 'sage-text', mutedWritingColourId: 'mint-text', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'sage-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-rust', name: 'Modern Rust', description: 'Rust, peach text', colourId: 'rust', textureId: 'modern-soft', buttonColourId: 'sunset', accentLineColourId: 'rust', writingColourId: 'peach-text', mutedWritingColourId: 'coral-text', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'peach-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-titanium', name: 'Modern Titanium', description: 'Titanium, silver text', colourId: 'titanium', textureId: 'modern-soft', buttonColourId: 'zinc', accentLineColourId: 'steel', writingColourId: 'silver-text', mutedWritingColourId: 'zinc-400', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'silver-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-forest-teal', name: 'Modern Forest Teal', description: 'Forest teal, mint text', colourId: 'forest-teal', textureId: 'modern-soft', buttonColourId: 'emerald', accentLineColourId: 'teal', writingColourId: 'mint-text', mutedWritingColourId: 'seafoam', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'mint-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-dusty-rose', name: 'Modern Dusty Rose', description: 'Dusty rose, coral text', colourId: 'dusty-rose', textureId: 'modern-soft', buttonColourId: 'lavender-rose', accentLineColourId: 'dusty-rose', writingColourId: 'coral-text', mutedWritingColourId: 'blush-text', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'coral-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-mauve', name: 'Modern Mauve', description: 'Mauve, lavender text', colourId: 'mauve', textureId: 'modern-soft', buttonColourId: 'thistle', accentLineColourId: 'plum-violet', writingColourId: 'lavender-text', mutedWritingColourId: 'lilac', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'lavender-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-denim', name: 'Modern Denim', description: 'Denim blue, sky text', colourId: 'denim', textureId: 'modern-soft', buttonColourId: 'blue', accentLineColourId: 'navy', writingColourId: 'sky-text', mutedWritingColourId: 'powder-blue', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'sky-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-spruce', name: 'Modern Spruce', description: 'Spruce green, mint text', colourId: 'spruce', textureId: 'modern-soft', buttonColourId: 'forest', accentLineColourId: 'spruce', writingColourId: 'mint-text', mutedWritingColourId: 'sage-text', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'mint-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-aubergine', name: 'Modern Aubergine', description: 'Aubergine, lavender text', colourId: 'aubergine', textureId: 'modern-soft', buttonColourId: 'plum', accentLineColourId: 'aubergine', writingColourId: 'lavender-text', mutedWritingColourId: 'lilac', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'lavender-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-merlot', name: 'Modern Merlot', description: 'Merlot, burgundy text', colourId: 'merlot', textureId: 'modern-soft', buttonColourId: 'wine', accentLineColourId: 'merlot', writingColourId: 'burgundy-text', mutedWritingColourId: 'rose-text', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'burgundy-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-apricot', name: 'Modern Apricot', description: 'Apricot, peach text', colourId: 'apricot', textureId: 'modern-soft', buttonColourId: 'peach-gold', accentLineColourId: 'apricot', writingColourId: 'peach-text', mutedWritingColourId: 'melon', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'peach-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-pewter-blue', name: 'Modern Pewter Blue', description: 'Pewter blue, steel text', colourId: 'pewter-blue', textureId: 'modern-soft', buttonColourId: 'steel', accentLineColourId: 'slate-blue', writingColourId: 'steel-text', mutedWritingColourId: 'zinc-400', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'steel-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-moonlight', name: 'Modern Moonlight', description: 'Moonlight blue-gray', colourId: 'moonlight', textureId: 'modern-soft', buttonColourId: 'slate-blue', accentLineColourId: 'moonlight', writingColourId: 'cool-white', mutedWritingColourId: 'steel-text', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'cool-white', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-muted-teal', name: 'Modern Muted Teal', description: 'Muted teal, aqua text', colourId: 'muted-teal', textureId: 'modern-soft', buttonColourId: 'sage-blue', accentLineColourId: 'muted-teal', writingColourId: 'aqua-text', mutedWritingColourId: 'seafoam', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'aqua-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-steel-blue', name: 'Modern Steel Blue', description: 'Steel blue, cool white', colourId: 'steel-blue', textureId: 'modern-soft', buttonColourId: 'blue', accentLineColourId: 'steel-blue', writingColourId: 'steel-text', mutedWritingColourId: 'powder-blue', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'steel-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-berry', name: 'Modern Berry', description: 'Berry, lavender text', colourId: 'berry', textureId: 'modern-soft', buttonColourId: 'plum', accentLineColourId: 'berry', writingColourId: 'lavender-text', mutedWritingColourId: 'lilac', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'lavender-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-terracotta', name: 'Modern Terracotta', description: 'Terracotta, peach text', colourId: 'terracotta', textureId: 'modern-soft', buttonColourId: 'rust', accentLineColourId: 'terracotta', writingColourId: 'peach-text', mutedWritingColourId: 'coral-text', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'peach-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-obsidian', name: 'Modern Obsidian', description: 'Obsidian black, zinc text', colourId: 'obsidian', textureId: 'modern-soft', buttonColourId: 'carbon', accentLineColourId: 'obsidian', writingColourId: 'zinc-200', mutedWritingColourId: 'zinc-500', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'zinc-200', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-pitch', name: 'Modern Pitch', description: 'Pitch black, silver text', colourId: 'pitch', textureId: 'modern-soft', buttonColourId: 'charcoal', accentLineColourId: 'obsidian', writingColourId: 'silver-text', mutedWritingColourId: 'zinc-400', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'silver-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-slate-deep', name: 'Modern Slate Deep', description: 'Deep slate, steel text', colourId: 'slate-deep', textureId: 'modern-soft', buttonColourId: 'gunmetal', accentLineColourId: 'slate-deep', writingColourId: 'steel-text', mutedWritingColourId: 'zinc-400', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'steel-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-tone-aurora', name: 'Modern Aurora', description: 'Aurora gradient', colourId: 'tone-3-aurora', textureId: 'modern-soft', buttonColourId: 'teal', accentLineColourId: null, writingColourId: 'seafoam', mutedWritingColourId: 'aqua-text', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'seafoam', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-tone-neon', name: 'Modern Neon', description: 'Neon gradient', colourId: 'tone-4-neon', textureId: 'modern-soft', buttonColourId: null, accentLineColourId: null, writingColourId: 'cool-white', mutedWritingColourId: 'powder-blue', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'cool-white', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-tone-fire', name: 'Modern Fire', description: 'Fire gradient', colourId: 'tone-3-fire', textureId: 'modern-soft', buttonColourId: null, accentLineColourId: null, writingColourId: 'cream-gold', mutedWritingColourId: 'peach-text', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'cream-gold', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-tone-ocean', name: 'Modern Ocean 2-tone', description: 'Ocean gradient', colourId: 'tone-2-ocean', textureId: 'modern-soft', buttonColourId: null, accentLineColourId: null, writingColourId: 'sky-text', mutedWritingColourId: 'aqua-text', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'sky-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-tone-forest', name: 'Modern Forest 2-tone', description: 'Forest gradient', colourId: 'tone-2-forest', textureId: 'modern-soft', buttonColourId: null, accentLineColourId: null, writingColourId: 'mint-text', mutedWritingColourId: 'sage-text', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'mint-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-tone-lavender', name: 'Modern Lavender 3-tone', description: 'Lavender gradient', colourId: 'tone-3-lavender', textureId: 'modern-soft', buttonColourId: null, accentLineColourId: null, writingColourId: 'lavender-text', mutedWritingColourId: 'lilac', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'lavender-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-tone-ember', name: 'Modern Ember', description: 'Ember gradient', colourId: 'tone-4-ember', textureId: 'modern-soft', buttonColourId: null, accentLineColourId: null, writingColourId: 'peach-text', mutedWritingColourId: 'coral-text', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'peach-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-tone-teal-orange', name: 'Modern Teal Orange', description: 'Teal to orange gradient', colourId: 'tone-2-teal-orange', textureId: 'modern-soft', buttonColourId: null, accentLineColourId: null, writingColourId: 'peach-text', mutedWritingColourId: 'seafoam', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'peach-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-pastel-mint', name: 'Modern Pastel Mint', description: 'Pastel mint, mint text', colourId: 'pastel-green', textureId: 'modern-soft', buttonColourId: 'mint', accentLineColourId: 'emerald', writingColourId: 'mint-text', mutedWritingColourId: 'eucalyptus', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'mint-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-pastel-pink', name: 'Modern Pastel Pink', description: 'Pastel pink, blush text', colourId: 'pastel-pink', textureId: 'modern-soft', buttonColourId: 'coral', accentLineColourId: 'pastel-pink', writingColourId: 'blush-text', mutedWritingColourId: 'lavender-rose-text', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'blush-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-pastel-purple', name: 'Modern Pastel Purple', description: 'Pastel purple, lavender text', colourId: 'pastel-purple', textureId: 'modern-soft', buttonColourId: 'lavender', accentLineColourId: 'pastel-purple', writingColourId: 'lavender-text', mutedWritingColourId: 'lilac', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'lavender-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },
  { id: 'modern-gold', name: 'Modern Gold', description: 'Gold, cream-gold text', colourId: 'gold', textureId: 'modern-soft', buttonColourId: 'dark-gold', accentLineColourId: 'gold', writingColourId: 'cream-gold', mutedWritingColourId: 'warm-white', buttonStyleId: 'flat', fontId: 'modern', textStyleId: 'medium', toastTextColourId: 'cream-gold', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true },

  /* ── Cyberpunk collection ────────────────────────────────── */
  { id: 'cyber-neon-violet', name: 'Cyber Violet', description: 'Neon violet, plasma text, tech font', colourId: 'neon-violet', textureId: 'modern-soft', buttonColourId: 'plasma', accentLineColourId: 'neon-violet', writingColourId: 'neon-violet-text', mutedWritingColourId: 'plasma-text', buttonStyleId: 'glossy', fontId: 'tech', textStyleId: 'medium', toastTextColourId: 'neon-violet-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'cyberpunk' },
  { id: 'cyber-neon-cyan', name: 'Cyber Cyan', description: 'Neon cyan, hologram accents', colourId: 'neon-cyan', textureId: 'modern-soft', buttonColourId: 'hologram', accentLineColourId: 'neon-cyan', writingColourId: 'neon-cyan-text', mutedWritingColourId: 'seafoam', buttonStyleId: 'glossy', fontId: 'tech', textStyleId: 'medium', toastTextColourId: 'neon-cyan-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'cyberpunk' },
  { id: 'cyber-synthwave', name: 'Synthwave', description: 'Hot pink, retro-futuristic', colourId: 'synthwave', textureId: 'modern-soft', buttonColourId: 'neon-pink', accentLineColourId: 'synthwave', writingColourId: 'synthwave-text', mutedWritingColourId: 'vaporwave-text', buttonStyleId: 'glossy', fontId: 'retro', textStyleId: 'medium', toastTextColourId: 'synthwave-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'cyberpunk' },
  { id: 'cyber-matrix', name: 'Matrix', description: 'Green code rain', colourId: 'matrix', textureId: 'modern-soft', buttonColourId: 'neon-green', accentLineColourId: 'matrix', writingColourId: 'matrix-text', mutedWritingColourId: 'eucalyptus', buttonStyleId: 'flat', fontId: 'mono', textStyleId: 'normal', toastTextColourId: 'matrix-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'cyberpunk' },
  { id: 'cyber-vaporwave', name: 'Vaporwave', description: 'Pastel pink, dreamy', colourId: 'vaporwave', textureId: 'modern-soft', buttonColourId: 'pastel-pink', accentLineColourId: 'vaporwave', writingColourId: 'vaporwave-text', mutedWritingColourId: 'blush-text', buttonStyleId: 'glossy', fontId: 'geometric', textStyleId: 'medium', toastTextColourId: 'vaporwave-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'cyberpunk' },
  { id: 'cyber-plasma', name: 'Plasma', description: 'Hot magenta, electric', colourId: 'plasma', textureId: 'modern-soft', buttonColourId: 'fuchsia', accentLineColourId: 'plasma', writingColourId: 'plasma-text', mutedWritingColourId: 'neon-violet-text', buttonStyleId: 'glossy', fontId: 'tech', textStyleId: 'medium', toastTextColourId: 'plasma-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'cyberpunk' },
  { id: 'cyber-laser', name: 'Laser Red', description: 'Pure red, aggressive', colourId: 'laser', textureId: 'modern-soft', buttonColourId: 'cyber-red', accentLineColourId: 'laser', writingColourId: 'ruby-text', mutedWritingColourId: 'garnet-text', buttonStyleId: 'glossy', fontId: 'industrial', textStyleId: 'bold', toastTextColourId: 'ruby-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'cyberpunk' },
  { id: 'cyber-hologram', name: 'Hologram', description: 'Teal holographic shimmer', colourId: 'hologram', textureId: 'modern-soft', buttonColourId: 'teal', accentLineColourId: 'hologram', writingColourId: 'neon-cyan-text', mutedWritingColourId: 'aqua-text', buttonStyleId: 'glossy', fontId: 'tech', textStyleId: 'medium', toastTextColourId: 'neon-cyan-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'cyberpunk' },
  { id: 'cyber-neon-lime', name: 'Neon Lime', description: 'Bright lime, hacker vibes', colourId: 'neon-lime', textureId: 'modern-soft', buttonColourId: 'matrix', accentLineColourId: 'neon-lime', writingColourId: 'matrix-text', mutedWritingColourId: 'eucalyptus', buttonStyleId: 'flat', fontId: 'mono', textStyleId: 'normal', toastTextColourId: 'matrix-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'cyberpunk' },
  { id: 'cyber-void', name: 'Void Runner', description: 'Pure black, neon cyan accent', colourId: 'void', textureId: 'modern-soft', buttonColourId: 'neon-cyan', accentLineColourId: 'void', writingColourId: 'neon-cyan-text', mutedWritingColourId: 'steel-text', buttonStyleId: 'flat', fontId: 'tech', textStyleId: 'medium', toastTextColourId: 'neon-cyan-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'cyberpunk' },
  { id: 'cyber-abyss', name: 'Abyss Neon', description: 'Deep blue, pink neon glow', colourId: 'abyss', textureId: 'modern-soft', buttonColourId: 'synthwave', accentLineColourId: 'abyss', writingColourId: 'synthwave-text', mutedWritingColourId: 'powder-blue', buttonStyleId: 'glossy', fontId: 'tech', textStyleId: 'medium', toastTextColourId: 'synthwave-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'cyberpunk' },
  { id: 'cyber-electric', name: 'Electric Storm', description: 'Electric blue, chrome accents', colourId: 'electric', textureId: 'modern-soft', buttonColourId: 'neon-blue', accentLineColourId: 'electric', writingColourId: 'cool-white', mutedWritingColourId: 'chrome-text', buttonStyleId: 'glossy', fontId: 'bold', textStyleId: 'medium', toastTextColourId: 'cool-white', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'cyberpunk' },

  /* ── Luxury collection ──────────────────────────────────── */
  { id: 'lux-sapphire', name: 'Luxury Sapphire', description: 'Royal sapphire, platinum text', colourId: 'sapphire', textureId: 'modern-soft', buttonColourId: 'lapis', accentLineColourId: 'sapphire', writingColourId: 'sapphire-text', mutedWritingColourId: 'platinum-text', buttonStyleId: 'glossy', fontId: 'luxury', textStyleId: 'medium', toastTextColourId: 'sapphire-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'luxury' },
  { id: 'lux-ruby', name: 'Luxury Ruby', description: 'Deep ruby, gold accents', colourId: 'ruby', textureId: 'modern-soft', buttonColourId: 'garnet', accentLineColourId: 'ruby', writingColourId: 'ruby-text', mutedWritingColourId: 'champagne-text', buttonStyleId: 'glossy', fontId: 'luxury', textStyleId: 'medium', toastTextColourId: 'ruby-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'luxury' },
  { id: 'lux-amethyst', name: 'Luxury Amethyst', description: 'Rich purple, elegant', colourId: 'amethyst', textureId: 'modern-soft', buttonColourId: 'tanzanite', accentLineColourId: 'amethyst', writingColourId: 'amethyst-text', mutedWritingColourId: 'lavender-text', buttonStyleId: 'glossy', fontId: 'luxury', textStyleId: 'medium', toastTextColourId: 'amethyst-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'luxury' },
  { id: 'lux-champagne', name: 'Luxury Champagne', description: 'Warm champagne, gold tones', colourId: 'champagne', textureId: 'modern-soft', buttonColourId: 'antique-gold', accentLineColourId: 'champagne', writingColourId: 'champagne-text', mutedWritingColourId: 'cream-gold', buttonStyleId: 'raised', fontId: 'elegant', textStyleId: 'medium', toastTextColourId: 'champagne-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'luxury' },
  { id: 'lux-cognac', name: 'Luxury Cognac', description: 'Rich cognac leather', colourId: 'cognac', textureId: 'modern-soft', buttonColourId: 'mahogany', accentLineColourId: 'cognac', writingColourId: 'champagne-text', mutedWritingColourId: 'sandstone-text', buttonStyleId: 'raised', fontId: 'elegant', textStyleId: 'medium', toastTextColourId: 'champagne-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'luxury' },
  { id: 'lux-ebony', name: 'Luxury Ebony', description: 'Dark ebony, brass accents', colourId: 'ebony', textureId: 'modern-soft', buttonColourId: 'truffle', accentLineColourId: 'ebony', writingColourId: 'brass-text', mutedWritingColourId: 'champagne-text', buttonStyleId: 'raised', fontId: 'luxury', textStyleId: 'medium', toastTextColourId: 'brass-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'luxury' },
  { id: 'lux-caviar', name: 'Luxury Caviar', description: 'Caviar black, platinum', colourId: 'caviar', textureId: 'modern-soft', buttonColourId: 'onyx', accentLineColourId: 'caviar', writingColourId: 'platinum-text', mutedWritingColourId: 'chrome-text', buttonStyleId: 'glossy', fontId: 'luxury', textStyleId: 'medium', toastTextColourId: 'platinum-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'luxury' },
  { id: 'lux-cashmere', name: 'Luxury Cashmere', description: 'Warm cashmere, soft elegance', colourId: 'cashmere', textureId: 'modern-soft', buttonColourId: 'driftwood', accentLineColourId: 'cashmere', writingColourId: 'champagne-text', mutedWritingColourId: 'sandstone-text', buttonStyleId: 'raised', fontId: 'elegant', textStyleId: 'normal', toastTextColourId: 'champagne-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'luxury' },
  { id: 'lux-onyx-gold', name: 'Onyx & Gold', description: 'Black onyx, gold text', colourId: 'onyx', textureId: 'modern-soft', buttonColourId: 'caviar', accentLineColourId: 'onyx', writingColourId: 'cream-gold', mutedWritingColourId: 'brass-text', buttonStyleId: 'glossy', fontId: 'luxury', textStyleId: 'medium', toastTextColourId: 'cream-gold', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'luxury' },
  { id: 'lux-mink', name: 'Luxury Mink', description: 'Warm mink fur, champagne', colourId: 'mink-fur', textureId: 'modern-soft', buttonColourId: 'umber', accentLineColourId: 'mink-fur', writingColourId: 'champagne-text', mutedWritingColourId: 'driftwood-text', buttonStyleId: 'raised', fontId: 'elegant', textStyleId: 'normal', toastTextColourId: 'champagne-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'luxury' },
  { id: 'lux-emerald', name: 'Luxury Emerald', description: 'Deep emerald, gold accents', colourId: 'emerald-deep', textureId: 'modern-soft', buttonColourId: 'jade-deep', accentLineColourId: 'emerald-deep', writingColourId: 'emerald-text', mutedWritingColourId: 'champagne-text', buttonStyleId: 'glossy', fontId: 'luxury', textStyleId: 'medium', toastTextColourId: 'emerald-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'luxury' },
  { id: 'lux-rose-gold', name: 'Luxury Rose Gold', description: 'Rose gold metallic', colourId: 'rose-gold-metal', textureId: 'modern-soft', buttonColourId: 'dusty-rose', accentLineColourId: 'rose-gold-metal', writingColourId: 'rose-metal-text', mutedWritingColourId: 'blush-text', buttonStyleId: 'glossy', fontId: 'elegant', textStyleId: 'medium', toastTextColourId: 'rose-metal-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'luxury' },

  /* ── Nature collection ──────────────────────────────────── */
  { id: 'nature-palm', name: 'Palm Garden', description: 'Tropical palm green', colourId: 'palm', textureId: 'modern-soft', buttonColourId: 'emerald', accentLineColourId: 'palm', writingColourId: 'mint-text', mutedWritingColourId: 'sage-text', buttonStyleId: 'flat', fontId: 'clean', textStyleId: 'medium', toastTextColourId: 'mint-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'nature' },
  { id: 'nature-ocean-breeze', name: 'Ocean Breeze', description: 'Bright ocean blue', colourId: 'ocean-breeze', textureId: 'modern-soft', buttonColourId: 'lagoon-deep', accentLineColourId: 'ocean-breeze', writingColourId: 'sky-text', mutedWritingColourId: 'aqua-text', buttonStyleId: 'flat', fontId: 'clean', textStyleId: 'medium', toastTextColourId: 'sky-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'nature' },
  { id: 'nature-mango', name: 'Mango Sunrise', description: 'Tropical mango orange', colourId: 'mango', textureId: 'modern-soft', buttonColourId: 'tiki', accentLineColourId: 'mango', writingColourId: 'peach-text', mutedWritingColourId: 'cinnamon-text', buttonStyleId: 'flat', fontId: 'rounded', textStyleId: 'medium', toastTextColourId: 'peach-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'nature' },
  { id: 'nature-hibiscus', name: 'Hibiscus', description: 'Tropical pink flower', colourId: 'hibiscus', textureId: 'modern-soft', buttonColourId: 'guava', accentLineColourId: 'hibiscus', writingColourId: 'blush-text', mutedWritingColourId: 'coral-text', buttonStyleId: 'flat', fontId: 'rounded', textStyleId: 'medium', toastTextColourId: 'blush-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'nature' },
  { id: 'nature-sandstone', name: 'Sandstone Canyon', description: 'Desert sandstone', colourId: 'sandstone', textureId: 'modern-soft', buttonColourId: 'driftwood', accentLineColourId: 'sandstone', writingColourId: 'sandstone-text', mutedWritingColourId: 'wheat-text', buttonStyleId: 'flat', fontId: 'clean', textStyleId: 'normal', toastTextColourId: 'sandstone-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'nature' },
  { id: 'nature-aurora-ice', name: 'Aurora Ice', description: 'Northern lights green', colourId: 'aurora-ice', textureId: 'modern-soft', buttonColourId: 'palm', accentLineColourId: 'aurora-ice', writingColourId: 'opal-text', mutedWritingColourId: 'mint-text', buttonStyleId: 'flat', fontId: 'clean', textStyleId: 'medium', toastTextColourId: 'opal-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'nature' },
  { id: 'nature-lagoon', name: 'Deep Lagoon', description: 'Hidden lagoon teal', colourId: 'lagoon-deep', textureId: 'modern-soft', buttonColourId: 'teal', accentLineColourId: 'lagoon-deep', writingColourId: 'aqua-text', mutedWritingColourId: 'seafoam', buttonStyleId: 'flat', fontId: 'clean', textStyleId: 'medium', toastTextColourId: 'aqua-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'nature' },
  { id: 'nature-papaya', name: 'Papaya Sunset', description: 'Warm papaya orange', colourId: 'papaya', textureId: 'modern-soft', buttonColourId: 'mango', accentLineColourId: 'papaya', writingColourId: 'topaz-text', mutedWritingColourId: 'peach-text', buttonStyleId: 'flat', fontId: 'rounded', textStyleId: 'medium', toastTextColourId: 'topaz-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'nature' },
  { id: 'nature-guava', name: 'Guava Fresh', description: 'Pink guava tropical', colourId: 'guava', textureId: 'modern-soft', buttonColourId: 'coral', accentLineColourId: 'guava', writingColourId: 'coral-text', mutedWritingColourId: 'blush-text', buttonStyleId: 'flat', fontId: 'rounded', textStyleId: 'medium', toastTextColourId: 'coral-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'nature' },
  { id: 'nature-jade', name: 'Jade Temple', description: 'Deep jade green', colourId: 'jade-deep', textureId: 'modern-soft', buttonColourId: 'emerald-deep', accentLineColourId: 'jade-deep', writingColourId: 'emerald-text', mutedWritingColourId: 'opal-text', buttonStyleId: 'flat', fontId: 'clean', textStyleId: 'medium', toastTextColourId: 'emerald-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'nature' },
  { id: 'nature-wheat', name: 'Wheat Fields', description: 'Golden wheat harvest', colourId: 'wheat', textureId: 'modern-soft', buttonColourId: 'sandstone', accentLineColourId: 'wheat', writingColourId: 'wheat-text', mutedWritingColourId: 'sandstone-text', buttonStyleId: 'flat', fontId: 'clean', textStyleId: 'normal', toastTextColourId: 'wheat-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'nature' },
  { id: 'nature-coconut', name: 'Coconut Beach', description: 'Sandy coconut', colourId: 'coconut', textureId: 'modern-soft', buttonColourId: 'driftwood', accentLineColourId: 'coconut', writingColourId: 'driftwood-text', mutedWritingColourId: 'sandstone-text', buttonStyleId: 'flat', fontId: 'rounded', textStyleId: 'normal', toastTextColourId: 'driftwood-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'nature' },

  /* ── Retro collection ───────────────────────────────────── */
  { id: 'retro-mustard-type', name: 'Retro Mustard', description: '70s mustard, typewriter', colourId: 'retro-mustard', textureId: 'none', buttonColourId: 'harvest', accentLineColourId: 'retro-mustard', writingColourId: 'cream-gold', mutedWritingColourId: 'warm-white', buttonStyleId: 'opaque', fontId: 'typewriter', textStyleId: 'normal', toastTextColourId: 'cream-gold', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'retro' },
  { id: 'retro-avocado', name: 'Avocado 70s', description: '70s green, retro vibes', colourId: 'avocado-70s', textureId: 'none', buttonColourId: 'olive-drab', accentLineColourId: 'avocado-70s', writingColourId: 'mint-text', mutedWritingColourId: 'sage-text', buttonStyleId: 'opaque', fontId: 'typewriter', textStyleId: 'normal', toastTextColourId: 'mint-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'retro' },
  { id: 'retro-burnt', name: 'Burnt Sienna', description: 'Warm burnt orange, retro', colourId: 'burnt-sienna', textureId: 'none', buttonColourId: 'rust-orange', accentLineColourId: 'burnt-sienna', writingColourId: 'peach-text', mutedWritingColourId: 'sandstone-text', buttonStyleId: 'opaque', fontId: 'newspaper', textStyleId: 'normal', toastTextColourId: 'peach-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'retro' },
  { id: 'retro-denim', name: 'Faded Denim', description: 'Washed denim blue', colourId: 'faded-denim', textureId: 'none', buttonColourId: 'ice-deep', accentLineColourId: 'faded-denim', writingColourId: 'sky-text', mutedWritingColourId: 'powder-blue', buttonStyleId: 'opaque', fontId: 'typewriter', textStyleId: 'normal', toastTextColourId: 'sky-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'retro' },
  { id: 'retro-harvest', name: 'Harvest Gold', description: 'Warm harvest, vintage', colourId: 'harvest', textureId: 'none', buttonColourId: 'retro-mustard', accentLineColourId: 'harvest', writingColourId: 'topaz-text', mutedWritingColourId: 'cream-gold', buttonStyleId: 'opaque', fontId: 'newspaper', textStyleId: 'normal', toastTextColourId: 'topaz-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'retro' },
  { id: 'retro-parchment', name: 'Parchment', description: 'Old parchment, sepia ink', colourId: 'parchment', textureId: 'none', buttonColourId: 'driftwood', accentLineColourId: 'parchment', writingColourId: 'driftwood-text', mutedWritingColourId: 'sandstone-text', buttonStyleId: 'opaque', fontId: 'newspaper', textStyleId: 'normal', toastTextColourId: 'driftwood-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'retro' },
  { id: 'retro-old-rose', name: 'Old Rose', description: 'Faded vintage rose', colourId: 'old-rose', textureId: 'none', buttonColourId: 'dusty-pink', accentLineColourId: 'old-rose', writingColourId: 'blush-text', mutedWritingColourId: 'rose-text', buttonStyleId: 'opaque', fontId: 'newspaper', textStyleId: 'normal', toastTextColourId: 'blush-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'retro' },
  { id: 'retro-olive', name: 'Olive Drab', description: 'Military olive, rugged', colourId: 'olive-drab', textureId: 'none', buttonColourId: 'avocado-70s', accentLineColourId: 'olive-drab', writingColourId: 'sage-text', mutedWritingColourId: 'mint-text', buttonStyleId: 'opaque', fontId: 'industrial', textStyleId: 'bold', toastTextColourId: 'sage-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'retro' },
  { id: 'retro-dusty-pink', name: 'Dusty Pink', description: 'Soft vintage pink', colourId: 'dusty-pink', textureId: 'none', buttonColourId: 'old-rose', accentLineColourId: 'dusty-pink', writingColourId: 'coral-text', mutedWritingColourId: 'blush-text', buttonStyleId: 'raised', fontId: 'elegant', textStyleId: 'normal', toastTextColourId: 'coral-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'retro' },
  { id: 'retro-rust', name: 'Rust Orange', description: 'Warm rust, vintage feel', colourId: 'rust-orange', textureId: 'none', buttonColourId: 'burnt-sienna', accentLineColourId: 'rust-orange', writingColourId: 'ochre-text', mutedWritingColourId: 'sandstone-text', buttonStyleId: 'opaque', fontId: 'typewriter', textStyleId: 'normal', toastTextColourId: 'ochre-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'retro' },
  { id: 'retro-sienna', name: 'Warm Sienna', description: 'Earthy sienna', colourId: 'sienna', textureId: 'none', buttonColourId: 'mahogany', accentLineColourId: 'sienna', writingColourId: 'mahogany-text', mutedWritingColourId: 'sandstone-text', buttonStyleId: 'opaque', fontId: 'newspaper', textStyleId: 'normal', toastTextColourId: 'mahogany-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'retro' },
  { id: 'retro-cinnamon', name: 'Cinnamon Spice', description: 'Warm cinnamon retro', colourId: 'cinnamon', textureId: 'none', buttonColourId: 'ochre', accentLineColourId: 'cinnamon', writingColourId: 'cinnamon-text', mutedWritingColourId: 'wheat-text', buttonStyleId: 'opaque', fontId: 'typewriter', textStyleId: 'normal', toastTextColourId: 'cinnamon-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'retro' },

  /* ── Minimalist collection ──────────────────────────────── */
  { id: 'min-iron', name: 'Iron Minimal', description: 'Pure iron, minimal design', colourId: 'iron', textureId: 'none', buttonColourId: 'dark-chrome', accentLineColourId: 'iron', writingColourId: 'chrome-text', mutedWritingColourId: 'zinc-400', buttonStyleId: 'flat', fontId: 'minimal', textStyleId: 'light', toastTextColourId: 'chrome-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'minimalist' },
  { id: 'min-platinum', name: 'Platinum Clean', description: 'Light platinum, clean', colourId: 'platinum', textureId: 'none', buttonColourId: 'brushed-silver', accentLineColourId: 'platinum', writingColourId: 'platinum-text', mutedWritingColourId: 'chrome-text', buttonStyleId: 'flat', fontId: 'minimal', textStyleId: 'light', toastTextColourId: 'platinum-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'minimalist' },
  { id: 'min-mercury', name: 'Mercury Flow', description: 'Flowing mercury silver', colourId: 'mercury', textureId: 'none', buttonColourId: 'brushed-silver', accentLineColourId: 'mercury', writingColourId: 'chrome-text', mutedWritingColourId: 'steel-text', buttonStyleId: 'flat', fontId: 'minimal', textStyleId: 'light', toastTextColourId: 'chrome-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'minimalist' },
  { id: 'min-snowfall', name: 'Snowfall White', description: 'Clean snowfall white', colourId: 'snowfall', textureId: 'none', buttonColourId: 'glacier', accentLineColourId: 'snowfall', writingColourId: 'cool-white', mutedWritingColourId: 'steel-text', buttonStyleId: 'flat', fontId: 'minimal', textStyleId: 'light', toastTextColourId: 'cool-white', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'minimalist' },
  { id: 'min-tin', name: 'Tin Minimal', description: 'Neutral tin gray', colourId: 'tin', textureId: 'none', buttonColourId: 'iron', accentLineColourId: 'tin', writingColourId: 'silver-text', mutedWritingColourId: 'zinc-400', buttonStyleId: 'flat', fontId: 'minimal', textStyleId: 'light', toastTextColourId: 'silver-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'minimalist' },
  { id: 'min-arctic', name: 'Arctic Clean', description: 'Clean arctic white', colourId: 'arctic', textureId: 'none', buttonColourId: 'glacier', accentLineColourId: 'arctic', writingColourId: 'cool-white', mutedWritingColourId: 'powder-blue', buttonStyleId: 'flat', fontId: 'geometric', textStyleId: 'light', toastTextColourId: 'cool-white', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'minimalist' },
  { id: 'min-opal', name: 'Opal Shimmer', description: 'Soft opal green-white', colourId: 'opal', textureId: 'none', buttonColourId: 'tourmaline', accentLineColourId: 'opal', writingColourId: 'opal-text', mutedWritingColourId: 'mint-text', buttonStyleId: 'flat', fontId: 'minimal', textStyleId: 'light', toastTextColourId: 'opal-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'minimalist' },
  { id: 'min-permafrost', name: 'Permafrost', description: 'Cool gray-blue minimal', colourId: 'permafrost', textureId: 'none', buttonColourId: 'frostbite', accentLineColourId: 'permafrost', writingColourId: 'chrome-text', mutedWritingColourId: 'steel-text', buttonStyleId: 'flat', fontId: 'minimal', textStyleId: 'light', toastTextColourId: 'chrome-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'minimalist' },
  { id: 'min-dove', name: 'Dove Minimal', description: 'Soft dove gray', colourId: 'dove', textureId: 'none', buttonColourId: 'silver', accentLineColourId: 'dove', writingColourId: 'snow', mutedWritingColourId: 'chrome-text', buttonStyleId: 'flat', fontId: 'geometric', textStyleId: 'light', toastTextColourId: 'snow', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'minimalist' },
  { id: 'min-silk', name: 'Silk Minimal', description: 'Silky smooth white', colourId: 'silk', textureId: 'none', buttonColourId: 'cream', accentLineColourId: 'silk', writingColourId: 'pearl', mutedWritingColourId: 'chrome-text', buttonStyleId: 'flat', fontId: 'minimal', textStyleId: 'light', toastTextColourId: 'pearl', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'minimalist' },
  { id: 'min-fog', name: 'Fog Minimal', description: 'Soft fog gray', colourId: 'fog', textureId: 'none', buttonColourId: 'storm', accentLineColourId: 'fog', writingColourId: 'silver-text', mutedWritingColourId: 'zinc-400', buttonStyleId: 'flat', fontId: 'humanist', textStyleId: 'light', toastTextColourId: 'silver-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'minimalist' },
  { id: 'min-pebble', name: 'Pebble', description: 'Neutral stone pebble', colourId: 'stone', textureId: 'none', buttonColourId: 'neutral', accentLineColourId: 'stone', writingColourId: 'pearl', mutedWritingColourId: 'steel-text', buttonStyleId: 'flat', fontId: 'minimal', textStyleId: 'light', toastTextColourId: 'pearl', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'minimalist' },

  /* ── Winter collection ──────────────────────────────────── */
  { id: 'winter-glacier', name: 'Glacier', description: 'Icy glacier blue', colourId: 'glacier', textureId: 'modern-soft', buttonColourId: 'ice-deep', accentLineColourId: 'glacier', writingColourId: 'cool-white', mutedWritingColourId: 'powder-blue', buttonStyleId: 'flat', fontId: 'clean', textStyleId: 'medium', toastTextColourId: 'cool-white', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'winter' },
  { id: 'winter-frostbite', name: 'Frostbite', description: 'Dark frostbitten blue', colourId: 'frostbite', textureId: 'modern-soft', buttonColourId: 'ice-deep', accentLineColourId: 'frostbite', writingColourId: 'cool-white', mutedWritingColourId: 'chrome-text', buttonStyleId: 'flat', fontId: 'clean', textStyleId: 'medium', toastTextColourId: 'cool-white', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'winter' },
  { id: 'winter-polar', name: 'Polar Night', description: 'Cold polar blue', colourId: 'polar', textureId: 'modern-soft', buttonColourId: 'frostbite', accentLineColourId: 'polar', writingColourId: 'cool-white', mutedWritingColourId: 'powder-blue', buttonStyleId: 'flat', fontId: 'clean', textStyleId: 'medium', toastTextColourId: 'cool-white', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'winter' },
  { id: 'winter-icicle', name: 'Icicle', description: 'Light icy blue', colourId: 'icicle', textureId: 'modern-soft', buttonColourId: 'glacier', accentLineColourId: 'icicle', writingColourId: 'cool-white', mutedWritingColourId: 'steel-text', buttonStyleId: 'flat', fontId: 'clean', textStyleId: 'light', toastTextColourId: 'cool-white', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'winter' },
  { id: 'winter-sky', name: 'Winter Sky', description: 'Pale winter sky', colourId: 'winter-sky', textureId: 'modern-soft', buttonColourId: 'polar', accentLineColourId: 'winter-sky', writingColourId: 'cool-white', mutedWritingColourId: 'powder-blue', buttonStyleId: 'flat', fontId: 'clean', textStyleId: 'light', toastTextColourId: 'cool-white', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'winter' },
  { id: 'winter-ice-deep', name: 'Deep Ice', description: 'Deep steel blue ice', colourId: 'ice-deep', textureId: 'modern-soft', buttonColourId: 'frostbite', accentLineColourId: 'ice-deep', writingColourId: 'sapphire-text', mutedWritingColourId: 'powder-blue', buttonStyleId: 'flat', fontId: 'clean', textStyleId: 'medium', toastTextColourId: 'sapphire-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'winter' },
  { id: 'winter-aurora', name: 'Winter Aurora', description: 'Northern lights, icy green', colourId: 'aurora-ice', textureId: 'modern-soft', buttonColourId: 'palm', accentLineColourId: 'aurora-ice', writingColourId: 'emerald-text', mutedWritingColourId: 'opal-text', buttonStyleId: 'flat', fontId: 'clean', textStyleId: 'medium', toastTextColourId: 'emerald-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'winter' },
  { id: 'winter-permafrost', name: 'Permafrost', description: 'Gray-blue permafrost', colourId: 'permafrost', textureId: 'modern-soft', buttonColourId: 'frostbite', accentLineColourId: 'permafrost', writingColourId: 'cool-white', mutedWritingColourId: 'chrome-text', buttonStyleId: 'flat', fontId: 'clean', textStyleId: 'medium', toastTextColourId: 'cool-white', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'winter' },
  { id: 'winter-aquamarine', name: 'Winter Aquamarine', description: 'Bright aquamarine ice', colourId: 'aquamarine', textureId: 'modern-soft', buttonColourId: 'hologram', accentLineColourId: 'aquamarine', writingColourId: 'neon-cyan-text', mutedWritingColourId: 'aqua-text', buttonStyleId: 'flat', fontId: 'clean', textStyleId: 'medium', toastTextColourId: 'neon-cyan-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'winter' },
  { id: 'winter-snowfall', name: 'Snowfall Night', description: 'Dark sky, snow white accents', colourId: 'deep-navy', textureId: 'modern-soft', buttonColourId: 'ice-deep', accentLineColourId: 'deep-navy', writingColourId: 'cool-white', mutedWritingColourId: 'powder-blue', buttonStyleId: 'flat', fontId: 'clean', textStyleId: 'medium', toastTextColourId: 'cool-white', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'winter' },

  /* ── Metallic collection ────────────────────────────────── */
  { id: 'metal-brass', name: 'Polished Brass', description: 'Warm polished brass', colourId: 'polished-brass', textureId: 'modern-soft', buttonColourId: 'antique-gold', accentLineColourId: 'polished-brass', writingColourId: 'brass-text', mutedWritingColourId: 'champagne-text', buttonStyleId: 'glossy', fontId: 'bold', textStyleId: 'semibold', toastTextColourId: 'brass-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'metallic' },
  { id: 'metal-silver', name: 'Brushed Silver', description: 'Cool brushed silver', colourId: 'brushed-silver', textureId: 'modern-soft', buttonColourId: 'dark-chrome', accentLineColourId: 'brushed-silver', writingColourId: 'chrome-text', mutedWritingColourId: 'steel-text', buttonStyleId: 'glossy', fontId: 'bold', textStyleId: 'semibold', toastTextColourId: 'chrome-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'metallic' },
  { id: 'metal-chrome', name: 'Dark Chrome', description: 'Dark chrome finish', colourId: 'dark-chrome', textureId: 'modern-soft', buttonColourId: 'iron', accentLineColourId: 'dark-chrome', writingColourId: 'chrome-text', mutedWritingColourId: 'zinc-400', buttonStyleId: 'glossy', fontId: 'bold', textStyleId: 'semibold', toastTextColourId: 'chrome-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'metallic' },
  { id: 'metal-rose', name: 'Rose Gold Metal', description: 'Metallic rose gold finish', colourId: 'rose-gold-metal', textureId: 'modern-soft', buttonColourId: 'copper-rose', accentLineColourId: 'rose-gold-metal', writingColourId: 'rose-metal-text', mutedWritingColourId: 'blush-text', buttonStyleId: 'glossy', fontId: 'elegant', textStyleId: 'medium', toastTextColourId: 'rose-metal-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'metallic' },
  { id: 'metal-bronze', name: 'Dark Bronze', description: 'Aged dark bronze', colourId: 'bronze-dark', textureId: 'modern-soft', buttonColourId: 'umber', accentLineColourId: 'bronze-dark', writingColourId: 'bronze-metal-text', mutedWritingColourId: 'sandstone-text', buttonStyleId: 'glossy', fontId: 'bold', textStyleId: 'semibold', toastTextColourId: 'bronze-metal-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'metallic' },
  { id: 'metal-antique', name: 'Antique Gold', description: 'Aged antique gold', colourId: 'antique-gold', textureId: 'modern-soft', buttonColourId: 'polished-brass', accentLineColourId: 'antique-gold', writingColourId: 'brass-text', mutedWritingColourId: 'cream-gold', buttonStyleId: 'glossy', fontId: 'luxury', textStyleId: 'medium', toastTextColourId: 'brass-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'metallic' },
  { id: 'metal-platinum', name: 'Platinum Finish', description: 'Bright platinum', colourId: 'platinum', textureId: 'modern-soft', buttonColourId: 'brushed-silver', accentLineColourId: 'platinum', writingColourId: 'platinum-text', mutedWritingColourId: 'chrome-text', buttonStyleId: 'glossy', fontId: 'bold', textStyleId: 'semibold', toastTextColourId: 'platinum-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'metallic' },
  { id: 'metal-mercury', name: 'Liquid Mercury', description: 'Flowing silver mercury', colourId: 'mercury', textureId: 'modern-soft', buttonColourId: 'brushed-silver', accentLineColourId: 'mercury', writingColourId: 'chrome-text', mutedWritingColourId: 'steel-text', buttonStyleId: 'glossy', fontId: 'tech', textStyleId: 'medium', toastTextColourId: 'chrome-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'metallic' },
  { id: 'metal-tin', name: 'Tin Plate', description: 'Matte tin plate', colourId: 'tin', textureId: 'modern-soft', buttonColourId: 'dark-chrome', accentLineColourId: 'tin', writingColourId: 'silver-text', mutedWritingColourId: 'zinc-400', buttonStyleId: 'flat', fontId: 'industrial', textStyleId: 'semibold', toastTextColourId: 'silver-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'metallic' },
  { id: 'metal-iron', name: 'Wrought Iron', description: 'Dark wrought iron', colourId: 'iron', textureId: 'modern-soft', buttonColourId: 'dark-chrome', accentLineColourId: 'iron', writingColourId: 'chrome-text', mutedWritingColourId: 'zinc-500', buttonStyleId: 'flat', fontId: 'industrial', textStyleId: 'bold', toastTextColourId: 'chrome-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'metallic' },

  /* ── Dark Pro collection ────────────────────────────────── */
  { id: 'dark-void', name: 'Void', description: 'Ultra-dark void black', colourId: 'void', textureId: 'modern-soft', buttonColourId: 'onyx', accentLineColourId: 'void', writingColourId: 'chrome-text', mutedWritingColourId: 'zinc-500', buttonStyleId: 'flat', fontId: 'mono', textStyleId: 'normal', toastTextColourId: 'chrome-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'dark-pro' },
  { id: 'dark-abyss', name: 'Abyss', description: 'Deep blue-black abyss', colourId: 'abyss', textureId: 'modern-soft', buttonColourId: 'deep-navy', accentLineColourId: 'abyss', writingColourId: 'sapphire-text', mutedWritingColourId: 'powder-blue', buttonStyleId: 'flat', fontId: 'tech', textStyleId: 'medium', toastTextColourId: 'sapphire-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'dark-pro' },
  { id: 'dark-obsidian-blue', name: 'Obsidian Blue', description: 'Dark obsidian with blue', colourId: 'obsidian-blue', textureId: 'modern-soft', buttonColourId: 'deep-sapphire', accentLineColourId: 'obsidian-blue', writingColourId: 'lapis-text', mutedWritingColourId: 'powder-blue', buttonStyleId: 'flat', fontId: 'tech', textStyleId: 'medium', toastTextColourId: 'lapis-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'dark-pro' },
  { id: 'dark-deep-maroon', name: 'Deep Maroon', description: 'Ultra-dark maroon', colourId: 'deep-maroon', textureId: 'modern-soft', buttonColourId: 'deep-burgundy', accentLineColourId: 'deep-maroon', writingColourId: 'ruby-text', mutedWritingColourId: 'garnet-text', buttonStyleId: 'flat', fontId: 'tech', textStyleId: 'medium', toastTextColourId: 'ruby-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'dark-pro' },
  { id: 'dark-deep-violet', name: 'Deep Violet', description: 'Ultra-dark violet', colourId: 'deep-violet', textureId: 'modern-soft', buttonColourId: 'tanzanite', accentLineColourId: 'deep-violet', writingColourId: 'amethyst-text', mutedWritingColourId: 'tanzanite-text', buttonStyleId: 'flat', fontId: 'tech', textStyleId: 'medium', toastTextColourId: 'amethyst-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'dark-pro' },
  { id: 'dark-deep-teal-pro', name: 'Deep Teal Pro', description: 'Ultra-dark teal', colourId: 'deep-teal', textureId: 'modern-soft', buttonColourId: 'lagoon-deep', accentLineColourId: 'deep-teal', writingColourId: 'neon-cyan-text', mutedWritingColourId: 'aqua-text', buttonStyleId: 'flat', fontId: 'mono', textStyleId: 'normal', toastTextColourId: 'neon-cyan-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'dark-pro' },
  { id: 'dark-deep-olive', name: 'Deep Olive Pro', description: 'Military dark olive', colourId: 'deep-olive', textureId: 'modern-soft', buttonColourId: 'deep-forest', accentLineColourId: 'deep-olive', writingColourId: 'matrix-text', mutedWritingColourId: 'sage-text', buttonStyleId: 'flat', fontId: 'mono', textStyleId: 'normal', toastTextColourId: 'matrix-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'dark-pro' },
  { id: 'dark-deep-charcoal', name: 'Deep Charcoal Pro', description: 'Deepest charcoal', colourId: 'deep-charcoal', textureId: 'modern-soft', buttonColourId: 'caviar', accentLineColourId: 'deep-charcoal', writingColourId: 'chrome-text', mutedWritingColourId: 'zinc-500', buttonStyleId: 'flat', fontId: 'tech', textStyleId: 'medium', toastTextColourId: 'chrome-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'dark-pro' },
  { id: 'dark-deep-amber', name: 'Deep Amber Pro', description: 'Dark amber, warm glow', colourId: 'deep-amber', textureId: 'modern-soft', buttonColourId: 'deep-copper', accentLineColourId: 'deep-amber', writingColourId: 'ochre-text', mutedWritingColourId: 'brass-text', buttonStyleId: 'flat', fontId: 'tech', textStyleId: 'medium', toastTextColourId: 'ochre-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'dark-pro' },
  { id: 'dark-deep-sapphire', name: 'Deep Sapphire Pro', description: 'Midnight sapphire', colourId: 'deep-sapphire', textureId: 'modern-soft', buttonColourId: 'obsidian-blue', accentLineColourId: 'deep-sapphire', writingColourId: 'sapphire-text', mutedWritingColourId: 'lapis-text', buttonStyleId: 'flat', fontId: 'tech', textStyleId: 'medium', toastTextColourId: 'sapphire-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'dark-pro' },

  /* ── Gradient collection ────────────────────────────────── */
  { id: 'grad-teal-orange', name: 'Gradient Teal Orange', description: 'Teal to orange gradient', colourId: 'tone-2-teal-orange', textureId: 'modern-soft', buttonColourId: 'teal', accentLineColourId: null, writingColourId: 'peach-text', mutedWritingColourId: 'seafoam', buttonStyleId: 'flat', fontId: 'geometric', textStyleId: 'medium', toastTextColourId: 'peach-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'gradient' },
  { id: 'grad-ocean-fire', name: 'Gradient Ocean Fire', description: 'Ocean to fire', colourId: 'tone-4-ocean-fire', textureId: 'modern-soft', buttonColourId: 'ocean', accentLineColourId: null, writingColourId: 'cool-white', mutedWritingColourId: 'peach-text', buttonStyleId: 'flat', fontId: 'geometric', textStyleId: 'medium', toastTextColourId: 'cool-white', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'gradient' },
  { id: 'grad-midnight-amber', name: 'Gradient Midnight Amber', description: 'Midnight to amber', colourId: 'tone-3-midnight-teal-amber', textureId: 'modern-soft', buttonColourId: 'midnight', accentLineColourId: null, writingColourId: 'cream-gold', mutedWritingColourId: 'powder-blue', buttonStyleId: 'flat', fontId: 'geometric', textStyleId: 'medium', toastTextColourId: 'cream-gold', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'gradient' },
  { id: 'grad-candy', name: 'Gradient Candy', description: 'Sweet candy gradient', colourId: 'tone-4-candy', textureId: 'modern-soft', buttonColourId: 'pastel-pink', accentLineColourId: null, writingColourId: 'blush-text', mutedWritingColourId: 'coral-text', buttonStyleId: 'glossy', fontId: 'rounded', textStyleId: 'medium', toastTextColourId: 'blush-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'gradient' },
  { id: 'grad-sunset', name: 'Gradient Sunset', description: 'Golden sunset tones', colourId: 'tone-3-sunset', textureId: 'modern-soft', buttonColourId: 'orange', accentLineColourId: null, writingColourId: 'peach-text', mutedWritingColourId: 'cream-gold', buttonStyleId: 'flat', fontId: 'geometric', textStyleId: 'medium', toastTextColourId: 'peach-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'gradient' },
  { id: 'grad-berry', name: 'Gradient Berry', description: 'Rich berry blend', colourId: 'tone-2-berry', textureId: 'modern-soft', buttonColourId: 'berry', accentLineColourId: null, writingColourId: 'lavender-text', mutedWritingColourId: 'lilac', buttonStyleId: 'flat', fontId: 'geometric', textStyleId: 'medium', toastTextColourId: 'lavender-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'gradient' },
  { id: 'grad-rainbow', name: 'Gradient Rainbow', description: 'Full spectrum rainbow', colourId: 'tone-4-rainbow', textureId: 'modern-soft', buttonColourId: null, accentLineColourId: null, writingColourId: 'cool-white', mutedWritingColourId: 'chrome-text', buttonStyleId: 'flat', fontId: 'geometric', textStyleId: 'medium', toastTextColourId: 'cool-white', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'gradient' },
  { id: 'grad-dark-teal-warm', name: 'Gradient Dark Teal Warm', description: 'Dark teal to warm amber', colourId: 'tone-4-dark-teal-warm', textureId: 'modern-soft', buttonColourId: 'teal', accentLineColourId: null, writingColourId: 'cream-gold', mutedWritingColourId: 'aqua-text', buttonStyleId: 'flat', fontId: 'geometric', textStyleId: 'medium', toastTextColourId: 'cream-gold', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'gradient' },
  { id: 'grad-ice', name: 'Gradient Ice', description: 'Cool ice blues', colourId: 'tone-4-ice', textureId: 'modern-soft', buttonColourId: 'glacier', accentLineColourId: null, writingColourId: 'cool-white', mutedWritingColourId: 'powder-blue', buttonStyleId: 'flat', fontId: 'clean', textStyleId: 'light', toastTextColourId: 'cool-white', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'gradient' },
  { id: 'grad-wine', name: 'Gradient Wine', description: 'Deep wine gradient', colourId: 'tone-4-wine', textureId: 'modern-soft', buttonColourId: 'wine', accentLineColourId: null, writingColourId: 'burgundy-text', mutedWritingColourId: 'garnet-text', buttonStyleId: 'flat', fontId: 'elegant', textStyleId: 'medium', toastTextColourId: 'burgundy-text', mobileNavStyle: 'bottom', themeVariant: 'modern', isFullPreset: true, presetCategory: 'gradient' },

  /* ── Expanded studio collection ─────────────────────────── */
  ...EXPANDED_QUICK_PRESETS,
  ...EXPANDED_FULL_PRESETS,
];

export function getThemeColour(id) {
  return THEME_COLOURS.find((c) => c.id === id) || THEME_COLOURS[0];
}

export function getThemeTexture(id) {
  return THEME_TEXTURES.find((t) => t.id === id) || THEME_TEXTURES[0];
}

export function getThemePreset(id) {
  return THEME_PRESETS.find((p) => p.id === id) || THEME_PRESETS[0];
}

export function getThemeFont(id) {
  return THEME_FONTS.find((f) => f.id === id) || THEME_FONTS[0];
}

export function getThemeButtonStyle(id) {
  return THEME_BUTTON_STYLES.find((b) => b.id === id) || THEME_BUTTON_STYLES[0];
}

export function getThemeWritingColour(id) {
  return THEME_WRITING_COLOURS.find((w) => w.id === id) || THEME_WRITING_COLOURS[0];
}

export function getThemeTextStyle(id) {
  return THEME_TEXT_STYLES.find((t) => t.id === id) || THEME_TEXT_STYLES[0];
}

export { EXPANDED_PRESET_CATEGORIES };
