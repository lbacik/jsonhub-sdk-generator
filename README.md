# jh-client-generator

Minimalny projekt B do generowania SDK z OpenAPI na podstawie specyfikacji pobieranej spod URL.

Założenia:

- projekt A publikuje specyfikację OpenAPI jako `json` lub `yaml`,
- projekt B uruchamia jeden CLI,
- CLI pobiera specyfikację, zapisuje ją lokalnie w `.cache/`,
- następnie wywołuje `openapi-generator` dla wybranego języka.

## Dlaczego taka architektura

To jest najprostsze rozwiązanie, które nadal daje kontrolę:

- logika pobierania specyfikacji jest u Ciebie,
- logika generowania kodu jest delegowana do sprawdzonego `openapi-generator`,
- łatwo dodać kolejne targety albo własne szablony,
- można uruchamiać lokalnie, w CI i z crona bez przepisywania generatora od zera.

## Obsługiwane targety

- `ts` -> `typescript-fetch`
- `js` -> `javascript`
- `python` -> `python`
- `php` -> `php`

## Instalacja

```bash
npm install
```

Wymagany Node.js: `>=20.10.0`

## Użycie

### TypeScript

```bash
npm run generate -- \
  --url https://example.com/openapi.json \
  --target ts \
  --package-name my-api-sdk
```

Jeżeli nie podasz `--output`, klient trafi domyślnie do `generated/<target>`.
Jeżeli podasz `--output`, ta ścieżka jest traktowana jako finalny katalog wyjściowy:

```bash
npm run generate -- \
  --url https://example.com/openapi.json \
  --target ts \
  --output ../jh-client
```

W tym przykładzie SDK zostanie wygenerowane do `../jh-client`, bez dopisywania `/ts`.

Przy specyfikacjach JSON z wieloma formatami odpowiedzi CLI zawsze redukuje pobraną
specyfikację do **Canonical Client Spec** przed generacją — dokumentu z dokładnie jedną
reprezentacją na operację, zgodnie z jedną, współdzieloną polityką (patrz sekcja niżej),
tak żeby generator budował modele tylko dla wybranej reprezentacji w `requestBody` i
`responses`. Ten dokument trafia jako osobny plik do `.cache/canonical-client-spec.json`,
więc można go otworzyć i przejrzeć niezależnie od tego, co wygenerował
`openapi-generator`.

Jeżeli po generacji w `generated/ts/src/models` zostają modele, które nie są osiągalne
z wygenerowanych klas API, możesz uruchomić dodatkowe przycinanie:

```bash
npm run generate -- \
  --url https://example.com/openapi.json \
  --target ts \
  --package-name my-api-sdk \
  --prune-unused-models
```

### JavaScript

```bash
npm run generate -- \
  --url https://example.com/openapi.json \
  --target js \
  --package-name my-api-sdk-js
```

### Python

```bash
npm run generate -- \
  --url https://example.com/openapi.yaml \
  --target python \
  --package-name my_api_sdk
```

### PHP

```bash
npm run generate -- \
  --url https://example.com/openapi.json \
  --target php \
  --package-name MyCompanyApiSdk \
  --composer-name my-company/api-sdk
```

## Nagłówki do pobrania specyfikacji

Jeżeli specyfikacja jest chroniona, możesz przekazać nagłówki HTTP:

```bash
npm run generate -- \
  --url https://example.com/openapi.json \
  --target ts \
  --header "Authorization: Bearer TOKEN" \
  --header "X-Tenant: demo"
```

## Dodatkowe parametry generatora

Możesz dopisać własne `additionalProperties`:

```bash
npm run generate -- \
  --url https://example.com/openapi.json \
  --target ts \
  --property supportsES6=true \
  --property npmVersion=2.0.0
```

## Canonical Client Spec

Jeżeli specyfikacja wystawia kilka wariantów `content` dla tej samej operacji, CLI
redukuje ją przed generacją do dokładnie jednej reprezentacji na operację, według
jednej, współdzielonej polityki — zamiast pojedynczej globalnej flagi
`--prefer-media-type` (usuniętej):

```
response 2xx      -> application/hal+json, z fallbackiem do application/json
response 4xx/5xx  -> application/problem+json
request body      -> application/json
  PATCH           -> application/merge-patch+json
  formularze OAuth -> application/x-www-form-urlencoded
```

Wybór dla `responses` opiera się na kodzie statusu, a dla `requestBody` — na metodzie
HTTP i obecności `application/x-www-form-urlencoded` w treści (formularze OAuth). Jeżeli
żaden z preferowanych typów nie występuje w `content`, CLI zachowuje pierwszy dostępny
typ, więc każda operacja zawsze kończy z dokładnie jedną reprezentacją.

Redukcja jest czystą transformacją dokumentu (bez sieci i bez generowania kodu) i działa
obecnie dla specyfikacji w formacie JSON. Wynik trafia jako osobny, możliwy do
zainspekcjonowania plik do `.cache/canonical-client-spec.json`, i to on — a nie surowo
pobrana specyfikacja — jest wejściem dla `openapi-generator`.

## Przycinanie nieużywanych modeli

Flaga `--prune-unused-models` działa obecnie dla targetu `ts`.

To nie jest natywna opcja `openapi-generator`. CLI najpierw generuje pełny klient
`typescript-fetch`, a potem usuwa z `src/models` i `docs/` te modele, które nie są
osiągalne z `src/apis/*` ani z zależności modeli używanych przez API.

W praktyce to pomaga przy specyfikacjach, które zawierają wiele alternatywnych
reprezentacji albo nadmiarowe schematy pomocnicze, ale nadal najskuteczniejszą
redukcją liczby modeli zwykle pozostaje redukcja do Canonical Client Spec opisana
wyżej.

## Przykładowy dalszy rozwój

To, co zwykle warto dodać w kolejnym kroku:

1. plik konfiguracyjny `clients.config.json` z listą klientów do generacji,
2. osobne presety per język zamiast jednej mapy w kodzie,
3. własne szablony Mustache dla `openapi-generator`,
4. walidację specyfikacji przed generacją,
5. publikację paczek do npm / PyPI / Packagist w CI.

## Przykład następnego kroku

Jeżeli chcesz generować wiele SDK jednym poleceniem, rozszerzyłbym projekt o konfigurację w tym stylu:

```json
{
  "specUrl": "https://example.com/openapi.json",
  "targets": [
    {
      "name": "frontend-ts",
      "target": "ts",
      "packageName": "@acme/api-sdk"
    },
    {
      "name": "backend-python",
      "target": "python",
      "packageName": "acme_api_sdk"
    },
    {
      "name": "legacy-php",
      "target": "php",
      "packageName": "AcmeApiSdk",
      "composerName": "acme/api-sdk"
    }
  ]
}
```

Wtedy CLI zamiast pojedynczego `--target` czytałby konfigurację i generował wszystkie klienty w jednym przebiegu.
