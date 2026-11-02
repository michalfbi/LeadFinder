## Pobieranie

| Twój Mac | Plik |
| --- | --- |
| Procesor Apple (M1, M2, M3, M4…) | `LeadFinder-…-mac-AppleSilicon.dmg` |
| Procesor Intel | `LeadFinder-…-mac-Intel.dmg` |

Nie wiesz, jaki masz procesor? Menu  → **Ten Mac** → wiersz **Układ** (Apple M…) lub **Procesor** (Intel).

## Instalacja

1. Otwórz pobrany plik `.dmg` i przeciągnij **LeadFinder** do folderu **Aplikacje**.
2. Uruchom LeadFinder z folderu Aplikacje. Przy pierwszym uruchomieniu macOS pokaże ostrzeżenie, bo aplikacja nie jest podpisana certyfikatem Apple Developer. Kliknij **Gotowe** (nie „Przenieś do kosza”).
3. Otwórz **Ustawienia systemowe → Prywatność i ochrona**, przewiń w dół i przy komunikacie o LeadFinder kliknij **Otwórz mimo to**, a potem potwierdź hasłem.

Jeśli macOS pisze, że aplikacja „jest uszkodzona”, wpisz w Terminalu jedną komendę i uruchom ją ponownie:

```
xattr -dr com.apple.quarantine /Applications/LeadFinder.app
```

## Uprawnienia

- **Automatyzacja → Wiadomości**: macOS zapyta przy pierwszej wysyłce SMS. Kliknij **OK**.
- **Pełny dostęp do dysku**: potrzebny do wykrywania odpowiedzi klientów (historia Wiadomości). Ustawienia systemowe → Prywatność i ochrona → Pełny dostęp do dysku → dodaj LeadFinder.

## Aktualizacja

Pobierz nowszy `.dmg` i przeciągnij LeadFinder do Aplikacji, zastępując starą wersję. Baza leadów, ustawienia i czarna lista zostają na Macu bez zmian.
