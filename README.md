

## Linux

```sh
npm install        # regenera las dependencias nativas para Linux
npm start          # ejecuta la app
npm run dist:linux # genera un AppImage en dist/
```

El modo «estante en el escritorio» usa una ventana de tipo `desktop`. En entornos X11
(GNOME, KDE, XFCE…) queda detrás de las demás ventanas. En Wayland (p. ej. Hyprland)
se abre como una ventana sin bordes con el título `Manga Desktop - Estante`; usa una
regla de ventana de tu compositor (flotante, posición/tamaño de la pantalla, sin foco)
para fijarla.

## Juegos de Steam

«Importar juegos de Steam» busca los juegos instalados en las rutas por defecto de Steam
(Windows: `Program Files (x86)\Steam` y `Program Files\Steam`; Linux: `~/.local/share/Steam`,
`~/.steam`, Flatpak y Snap) y en todas las bibliotecas que liste `libraryfolders.vdf`.
Proton, los runtimes de Steam y los redistribuibles se descartan.

Las portadas (600×900) y los logos del lomo salen de SteamGridDB. Pon tu clave API en
**Ajustes** (consíguela en https://www.steamgriddb.com/profile/preferences/api). Las imágenes
se guardan en `steam-art/` dentro de la carpeta de datos de la app. Sin clave, se usan las
portadas que el cliente de Steam tiene en su caché. Al elegir un juego en el estante se abre
con `steam://rungameid/<appid>`.

### Cajas 3D (frente, lomo y contraportada)

Los juegos se guardan de lomo, como cajas apiladas (sin pósit; las notas siguen disponibles para
las demás obras con la opción `noteFor` del estante). Las cajas tienen el lomo redondeado, como un
libro de tapa dura. Al sacar un juego del estante (sin pósit), la caja se gira arrastrando con el ratón (se asienta en la
cara más cercana), con la rueda o con las flechas ← →; un clic sobre ella abre el juego y uno fuera la devuelve.

- **Cajas reales:** en Ajustes, «Descargar cajas reales (LaunchBox)» baja la base pública de
  LaunchBox Games DB (~105 MB, unos segundos de indexado) y guarda un índice pequeño
  (`launchbox-index.json`). Si un juego tiene ahí lomo o contraportada, se usan los escaneos
  reales, y también su frente para que las caras casen.
- **Cajas generadas:** para el resto, el lomo se compone con el borde de la portada y el logo, y
  la contraportada con el banner (SteamGridDB), la descripción y tres capturas de la tienda de Steam.

### Portadas, lomos y caché

- **Portada:** caja real de LaunchBox → SteamGridDB → caché del cliente de Steam (formato antiguo y el
  actual con subcarpetas) → CDN de la tienda de Steam → una compuesta con la cabecera de la tienda.
  Siempre hay portada.
- **Lomo generado:** placa de Steam arriba, el logo del juego y, al pie, la editora y la desarrolladora.
  Sus logos salen de Wikidata o de la ficha de la empresa en la Wikipedia en inglés (con espera y
  reintentos, porque limitan las peticiones). Si no hay logo, se escribe el nombre.
- **Caché:** las imágenes descargadas se reducen antes de guardarse, y los lomos y contraportadas
  compuestos se guardan en `steam-art/`. La primera carga con muchos juegos tarda (unos 45 s con 71,
  sobre todo por Wikidata); las siguientes, alrededor de un segundo. Al cambiar la clave de SteamGridDB
  o actualizar LaunchBox, las caras compuestas se rehacen.

### Juegos no instalados y discos

- «Importar juegos de Steam» trae también los juegos que no están instalados. Con una **clave de la
  Web API de Steam** en Ajustes (https://steamcommunity.com/dev/apikey) se lee la biblioteca completa de
  las cuentas de `loginusers.vdf`. Sin clave, o si la cuenta es privada, se usan los juegos jugados alguna
  vez en este PC (`userdata/*/config/localconfig.vdf`), con su nombre y tipo leídos de
  `appcache/appinfo.vdf`; solo se agregan los que son juegos.
- Los no instalados van en sus propias baldas, al final, envueltos en plástico y con un pósit «No
  instalados». Si se instalan desde Steam, salen de esa balda solos (el estado se consulta al cargar).
- Las cajas son como las de DVD: lomo redondeado a la izquierda, contraportada y cantos. Al hacer clic se
  abre la tapa hasta quedar plana: a la izquierda el manual y a la derecha el disco en su bandeja: el escaneo real de
  LaunchBox (tipo «Disc») o uno generado con el arte, el logo y el icono de Steam. Un clic en el disco
  juega o, si no está instalado, abre el instalador de Steam (`steam://install/<appid>`).
- **Lomos generados con arte:** el arte ancho del juego (el «hero» de la biblioteca de Steam, el mismo que
  muestra SteamDB, que no tiene API propia), recortado en su franja más colorida. En Ajustes se elige el estilo:
  **banda** (por defecto: arte arriba que se funde con el color de la portada, con el logo abajo), **color**
  (color liso con una ventana de arte), **arte** (arte a todo el alto) o **envolvente** (sigue el borde de la
  portada). Cada estilo se guarda aparte, así que volver a uno ya usado es instantáneo.
- Si el logo se confunde con el color de detrás, lleva un contorno nítido del color contrario.

## Estante de mangas y cómics

Basado en el estante de manga-reader, pero solo con archivos locales (no busca nada en internet):

- **Carpetas de la biblioteca** (botón «+ Agregar carpeta» o Ajustes): se buscan CBZ, CBR, ZIP y PDF en ellas y en
  sus subcarpetas (sin las ocultas, como `.hd`) al abrir la app y con «Volver a buscar». Lo nuevo entra solo y lo
  que se borre del disco sale. «+ Añadir cómics» sigue sirviendo para archivos sueltos.
- **Obras y tomos**: la obra, el capítulo y el tomo salen del `ComicInfo.xml` del CBZ (`Series`, `Number`,
  `Volume`) o, si no lo hay, del nombre del archivo y de su carpeta («Capitulo 0012», «One Piece v03 c021»,
  «Berserk Vol. 2», «Saga #3»…). Los archivos de una misma obra van juntos en el estante, con un pósit por obra;
  si el ComicInfo indica tomos, cada tomo agrupa sus capítulos, y si no, cada capítulo es un tomo fino.
- El tomo que se está leyendo va de frente; al sacar uno, «Leer» lo abre por donde se dejó. Al pasar de la última
  página se sigue con el capítulo siguiente (y al retroceder desde la primera, con el anterior).
- **Tomos reales (en línea, como en manga-reader)**: solo metadatos e imágenes, los mangas siguen siendo los archivos
  locales. La obra se identifica en MangaDex por su título; el reparto capítulo → tomo sale de la lista de capítulos
  de Wikipedia y de MangaDex, contrastadas, y lo que falta se estima igual que en manga-reader (las funciones de
  `desktop/tomes-pure.cjs` son las suyas). Portadas originales de MangaDex (prefiere la japonesa); contraportadas por
  ISBN (Biblioteca Nacional de Japón, los ISBN japonés e inglés de la lista de Wikipedia y Open Library) con la imagen
  de Amazon; logo de la obra de Wikimedia Commons para el título de los lomos. El arte de cada lomo sale de su portada.
  Al sacar un tomo se puede girar (arrastrando, con la rueda o con ← →) para ver su contraportada.
  Todo se guarda en `tomes/` dentro de los datos de la app; sin red se usan los capítulos sueltos con sus portadas locales.
- Para tener mangas de prueba: `node tools/brave-cache-a-cbz.cjs --origin https://tu-servidor <carpeta>` exporta los capítulos guardados
  «en este dispositivo» por la webapp Manga Reader en Brave.
