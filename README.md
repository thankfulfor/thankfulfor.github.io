# AI Technical Writer Portfolio (Hugo + PaperMod)

Портфолио AI Technical Writer / Product UX Writer на Hugo с темой PaperMod.

## Stack

- Hugo
- Theme: PaperMod
- Mermaid / Swagger UI / Chart.js
- GitHub Actions + GitHub Pages

## Local run

```bash
git submodule update --init --recursive
hugo server
```

## Build

```bash
hugo --minify
```

## Deploy

Деплой настроен в `.github/workflows/ci.yml`.
При пуше в `main` сайт собирается и публикуется в `gh-pages`.

## Key content

- `/about/interview-pitch/`
- `/about/resume/`
- `/interactive-api/`
- `/game/find-doc-bug/`
