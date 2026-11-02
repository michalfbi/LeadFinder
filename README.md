# LeadFinder

## Pobierz aplikację na Maca

Najnowsza wersja: **[Releases → Latest](https://github.com/michalfbi/LeadFinder/releases/latest)**.
Wybierz `…-mac-AppleSilicon.dmg` (procesory M1–M4) albo `…-mac-Intel.dmg`. Instrukcja pierwszego uruchomienia
jest w opisie każdego wydania (aplikacja nie jest podpisana certyfikatem Apple Developer).

## Jak opublikować nową wersję

1. Na GitHubie wejdź w **Actions → Wydanie na macOS → Run workflow**.
2. Wpisz numer wersji wyższy od ostatniej (np. `1.0.1`) i kliknij **Run workflow**.
3. Po ok. 10 minutach wydanie z plikami `.dmg` i `.zip` pojawi się w **Releases**.

To samo robi wypchnięcie tagu `v1.0.1`. Każdy pull request uruchamia próbny build i testy, bez publikowania.
Lokalnie na Macu: `npm run package:mac` (pliki trafiają do folderu `release/`).

---

# Welcome to your Lovable project

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS
