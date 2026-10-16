export interface Book {
  id: string
  title: string
  sourceLanguage: string
  targetLanguage: string
  widthMm: number
  heightMm: number
  createdAt: string
  updatedAt: string
}

export type BookInput = Omit<Book, 'id' | 'createdAt' | 'updatedAt'>

// Extend this catalogue as more family languages are supported.
export const languages = [
  { tag: 'nl-NL', label: 'Dutch (Netherlands)' },
  { tag: 'pt-PT', label: 'Portuguese (Portugal)' },
  { tag: 'en-GB', label: 'English (United Kingdom)' },
  { tag: 'fr-FR', label: 'French (France)' },
  { tag: 'de-DE', label: 'German (Germany)' },
  { tag: 'es-ES', label: 'Spanish (Spain)' },
]

export const languageName = (tag: string) => languages.find((language) => language.tag === tag)?.label ?? tag

export const dimensionPresets = [
  { id: 'a5', label: 'A5 · 148 × 210 mm', width: 148, height: 210 },
  { id: 'a4', label: 'A4 · 210 × 297 mm', width: 210, height: 297 },
  { id: 'square-small', label: 'Small square · 180 × 180 mm', width: 180, height: 180 },
  { id: 'square', label: 'Square · 210 × 210 mm', width: 210, height: 210 },
  { id: 'landscape', label: 'Picture book · 280 × 210 mm', width: 280, height: 210 },
]

export function validateBook(input: BookInput): Partial<Record<keyof BookInput, string>> {
  const errors: Partial<Record<keyof BookInput, string>> = {}
  if (!input.title.trim()) errors.title = 'Give your book a title.'
  else if (input.title.trim().length > 200) errors.title = 'Use 200 characters or fewer.'
  for (const key of ['sourceLanguage', 'targetLanguage'] as const) {
    try {
      if (!input[key] || !Intl.getCanonicalLocales(input[key]).length) throw new Error()
    } catch { errors[key] = 'Choose a valid language.' }
  }
  for (const key of ['widthMm', 'heightMm'] as const) {
    if (!Number.isFinite(input[key]) || input[key] < 1 || input[key] > 2000) {
      errors[key] = 'Enter a size from 1 to 2,000 mm.'
    }
  }
  return errors
}
