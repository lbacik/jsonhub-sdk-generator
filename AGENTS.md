# AGENTS.md

## Cel repozytorium

To repozytorium zawiera projekt B: narzędzie CLI do generowania SDK na podstawie specyfikacji OpenAPI pobieranej spod URL.

Zakres:

- pobranie specyfikacji `json` lub `yaml`,
- wygenerowanie klienta dla wybranego targetu,
- utrzymanie prostego punktu wejścia do uruchamiania lokalnie i w CI.

Aktualnie wspierane targety:

- `ts`
- `js`
- `python`
- `php`

## Architektura

Główna logika znajduje się w:

- `src/cli.mjs`

Założenie architektoniczne:

- warstwa Node.js odpowiada za orkiestrację,
- właściwe generowanie kodu wykonuje `@openapitools/openapi-generator-cli`,
- wygenerowane artefakty trafiają do `generated/`,
- tymczasowo pobrana specyfikacja trafia do `.cache/`.

Nie dodawaj własnego generatora SDK od zera, jeżeli problem da się rozwiązać przez:

- konfigurację `openapi-generator`,
- dodatkowe `additionalProperties`,
- własne szablony generatora,
- warstwę post-processingu po generacji.

## Uruchamianie

Instalacja:

```bash
npm install
```

Pomoc:

```bash
npm run help
```

Przykład:

```bash
npm run generate -- \
  --url https://example.com/openapi.json \
  --target ts \
  --package-name my-api-sdk
```

## Zasady zmian

Priorytety:

1. prostota CLI,
2. przewidywalność generacji,
3. łatwość użycia w CI,
4. łatwość dodawania nowych targetów i presetów.

Przy zmianach:

- utrzymuj jeden główny punkt wejścia CLI, chyba że rozdzielenie odpowiedzialności jest już wyraźnie potrzebne,
- nie koduj na sztywno danych specyficznych dla jednego projektu A,
- nowe targety dopisuj przez konfigurację mapy targetów i minimalny zestaw reguł per język,
- preferuj parametryzację przez flagi CLI albo plik konfiguracyjny zamiast rozgałęzionego kodu,
- dokumentuj nowe flagi i scenariusze w `README.md`.

## Konwencje implementacyjne

- Używaj ESM i Node.js `>=20`.
- Trzymaj logikę parsowania opcji, pobierania specyfikacji i wywołania generatora rozdzieloną funkcjonalnie.
- Komunikaty błędów mają być krótkie i operacyjne.
- Jeżeli dodajesz nowe parametry generatora, expose'uj je przez CLI tylko wtedy, gdy mają realną wartość dla użytkownika.
- Jeżeli potrzeba bardziej złożonej konfiguracji, preferowany kierunek to plik typu `clients.config.json`.

## Oczekiwany dalszy rozwój

Naturalne kolejne kroki:

- obsługa wielu klientów z jednego pliku konfiguracyjnego,
- presety dla poszczególnych języków,
- wsparcie dla własnych szablonów Mustache,
- walidacja specyfikacji przed generacją,
- automaty publikacji paczek.

## Czego unikać

- mieszania logiki pobierania specyfikacji z logiką publikacji paczek w jednym module,
- ukrytych zależności od konkretnego URL lub konkretnego formatu odpowiedzi,
- ręcznego edytowania wygenerowanego kodu w `generated/` jako docelowego rozwiązania,
- rozbudowy CLI o funkcje niezwiązane z generowaniem SDK.
