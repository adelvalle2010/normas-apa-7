# Gestor APA 7 en Netlify

Contenido de la carpeta:

- `index.html`: el Gestor completo.
- `netlify/edge-functions/lector.js`: el lector de enlaces. Responde en `/api/lector`.
- `netlify.toml`: indica que no hay paso de compilación.

La página ya apunta a `/api/lector`, así que no hay nada que configurar.

## Publicar

**Opción A: GitHub + Netlify**
1. Sube la carpeta completa a un repositorio de GitHub, respetando la subcarpeta `netlify/edge-functions/`.
2. En Netlify: *Add new project* → *Import an existing project* → *GitHub* → elige el repositorio → *Deploy*.

**Opción B: terminal**
Dentro de la carpeta, ejecuta:
```
npx netlify-cli login
npx netlify-cli deploy --prod
```

No uses "arrastrar y soltar": publica la página, pero no el lector de enlaces.

## Probar
Abre `https://TU-SITIO.netlify.app/api/lector?url=https://example.com`.
Si ves la página "Example Domain", el lector funciona.
