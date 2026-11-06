# Manga Desktop

Lector local de CBZ, CBR y PDF para Windows. La biblioteca y el progreso se guardan en el perfil del usuario; los archivos originales permanecen donde están. El estante y el libro 3D reutilizan código de [manga-reader](https://git.nakano47.com/nino/manga-reader/).

## Uso

Ejecuta `Manga Desktop 0.1.0.exe` y añade tus archivos en la biblioteca. Crea una lista y marca los libros que quieres incluir; un mismo libro puede pertenecer a varias listas. Selecciona una lista y una pantalla y pulsa «Mostrar esta lista». Cada pantalla puede mostrar una lista distinta; «Quitar de esta pantalla» retira solo su estante. Mientras haya un fondo activo, cerrar la ventana deja la aplicación en la bandeja del sistema; desde allí puedes volver a abrirla o salir.

Los archivos CBR divididos en varios volúmenes no son compatibles. El tamaño máximo de un CBR es 512 MB y el de una página de cómic 64 MB.

En el escritorio, el menú central permite cambiar de lista en esa pantalla, actualizar los libros añadidos a la biblioteca, volver al estante, pasar páginas y controlar el zoom. Al acercar el estante, las flechas lo desplazan horizontalmente.

## Desarrollo

Con Node.js y npm instalados, ejecuta `npm ci` y después `npm start`. Para generar el ejecutable portátil, ejecuta `npm run dist`. Las pruebas se ejecutan con `node --test desktop/archive.test.cjs desktop/collections.test.cjs desktop/renderer.test.cjs`.

La prueba de CBR genera un archivo de prueba con `RAR_EXE` apuntando al ejecutable de RAR. Si no está definido, esa prueba se omite; la aplicación incluye su propio lector de CBR.

Esta versión es experimental: comprueba la interacción del estante con los iconos del escritorio antes de depender de ella. La compatibilidad con otras versiones de Windows y configuraciones de escala aún requiere pruebas. Los estantes deben volver a activarse al reiniciar la aplicación.
