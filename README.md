# NUBIVET

Plataforma web estática para identificación QR y organización de información de mascotas. Usa Supabase para PostgreSQL, autenticación administrativa y almacenamiento de fotografías.

## Inicio desde cero con Supabase

### Modo demostración local

Si Supabase no está configurado, la aplicación puede mostrar contenido de demostración guardado localmente, pero **no permite iniciar sesión en el panel**. El acceso administrativo solo se habilita con una cuenta creada en Supabase Authentication y autorizada en `admin_users`. Si las credenciales están configuradas pero Supabase no responde, la aplicación muestra un error y no guarda cambios en el navegador.

1. Crea un proyecto nuevo en [Supabase](https://supabase.com/). No se necesita importar registros de ejemplo.
2. Abre **SQL Editor**, pega el contenido de `schema.sql` y ejecútalo una sola vez. Crea las tablas vacías, políticas RLS, la vista pública segura y el bucket de fotos.
   - Si el proyecto ya tenía el esquema anterior, ejecuta también `cover-settings-migration.sql` para que el sitio público pueda leer la nueva portada.
3. En **Authentication > Users**, crea el primer usuario de administración con correo y contraseña. Desactiva el registro público de usuarios.
4. Copia el UUID de esa cuenta, abre **SQL Editor** y autorízala ejecutando:

   ```sql
   insert into public.admin_users (user_id)
   values ('UUID_DEL_USUARIO_ADMIN');
   ```

5. En **Project Settings > API**, copia el Project URL y la clave `anon`/publishable. Colócalas en `supabase-config.js`:

   ```js
   window.NUBIVET_CONFIG = {
     supabaseUrl: 'https://TU-PROYECTO.supabase.co',
     supabaseAnonKey: 'TU_CLAVE_PUBLICA_ANON'
   };
   ```

   La clave pública está diseñada para usarse desde el navegador: la seguridad depende de las políticas RLS del esquema. **Nunca pongas la clave `service_role` en este proyecto.**

6. Actualiza el teléfono inicial `+591 700 00000` en la tabla `app_settings`, usando el panel de administración una vez iniciado o editándolo en Supabase.
7. Publica los archivos de esta carpeta en un hosting de sitios estáticos con HTTPS. No abras la aplicación directamente mediante `file://`. La ruta publicada debe permitir acceder a `index.html`, `login.html`, `panel.html`, `styles.css`, `app.js`, `supabase-config.js` y `schema.sql`.
8. En **Authentication > URL Configuration**, añade el dominio HTTPS publicado como URL permitida.

Las credenciales de administración se validan con Supabase Auth y el permiso de la cuenta se comprueba en `admin_users`. Las solicitudes públicas solo pueden insertar datos nuevos con estado pendiente. La dirección y los datos privados de los propietarios no se exponen en el perfil QR público. Las imágenes aceptadas son JPG, PNG y WEBP de hasta 5 MB.

## Uso inicial

- Visita `index.html` para conocer el servicio, solicitar un collar, revisar los perfiles públicos y consultar los modelos CAT, MINI y MAX.
- Ingresa en `login.html` con el usuario creado en Supabase para administrar solicitudes y registrar mascotas.
- El panel incluye módulos separados para mascotas, dueños (con sus mascotas agrupadas) y la portada de inicio. Desde Mascotas puedes editar, borrar o cambiar entre “Perdida” y “Reencontrada”; desde Portada puedes subir una imagen JPG, PNG o WEBP de hasta 5 MB.
- Al registrar un perfil desde el panel se guarda la ficha en PostgreSQL, se crea su etiqueta QR y se puede descargar o imprimir el QR.
- La base comienza sin mascotas, propietarios ni solicitudes. Los nuevos datos se agregan desde el panel o desde la solicitud pública.
- Los datos guardados en versiones de prueba del navegador no se migran; esta configuración inicia una base nueva en Supabase.

## Publicación

La carpeta puede servirse desde un hosting estático. No requiere un servidor Node ni una clave privada en el navegador.

### Opciones gratuitas recomendadas

| Servicio | Para qué sirve | Consideraciones |
| --- | --- | --- |
| [Cloudflare Pages](https://pages.cloudflare.com/) | Publicar gratis el sitio estático y conectarlo al repositorio para que se actualice al subir cambios. Es la recomendación para este proyecto. | El plan Free tiene límites de compilaciones y tamaño por archivo; esta web no necesita un proceso de compilación. |
| [Netlify](https://www.netlify.com/pricing/) | Publicar la carpeta con despliegue automático desde Git o carga manual. | El plan Free usa un sistema de créditos y sus límites pueden cambiar. |
| [GitHub Pages](https://pages.github.com/) | Publicar los archivos estáticos directamente desde un repositorio GitHub. | Útil para una demostración; la web y `supabase-config.js` son públicos. La clave anon es pública por diseño, pero nunca subas una clave `service_role`. |
| [Vercel Hobby](https://vercel.com/pricing) | Publicar gratis un proyecto personal y obtener HTTPS. | Revisa las condiciones actuales del plan Hobby y el uso permitido para tu organización. |

### Base de datos gratuita

Para esta aplicación, la opción directa es [Supabase Free](https://supabase.com/pricing): incluye PostgreSQL, autenticación y almacenamiento de imágenes en el mismo proyecto. El plan publicado actualmente incluye 500 MB de base de datos y 1 GB de archivos; los proyectos gratuitos pueden pausarse tras una semana de inactividad y no incluyen copias de seguridad automáticas. Confirma siempre los límites vigentes antes de guardar datos reales.

**Combinación sugerida:** Cloudflare Pages para los archivos de la web + Supabase Free para PostgreSQL, usuarios administradores y fotos. El hosting de la página no es la base de datos: los datos solo se sincronizan entre dispositivos después de crear/configurar Supabase y ejecutar el esquema.

Antes de publicar:

1. Configura Supabase y el administrador siguiendo los pasos anteriores.
2. Completa `supabase-config.js` con el Project URL y la clave `anon`/publishable; no añadas `service_role`.
3. Publica el contenido de `stitch_mascota_segura_qr` (o configúrala como carpeta raíz del proyecto en el hosting), usando `index.html` como página de inicio.
4. Añade el dominio HTTPS del sitio a **Supabase > Authentication > URL Configuration**.
5. Inicia sesión desde `login.html`, verifica una vez crear/editar una mascota, cambiar su estado, actualizar la portada y abrir el QR desde otro dispositivo.
6. Cambia el teléfono inicial `+591 700 00000` por el número real desde el panel.

Si Supabase no está configurado, la aplicación muestra el modo demostración local: los cambios quedan en ese navegador y no se comparten ni son una base de datos real. Si Supabase sí está configurado pero no responde, el panel muestra el error en vez de guardar silenciosamente en modo local.
