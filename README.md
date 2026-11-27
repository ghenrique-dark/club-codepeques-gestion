# Gestión del Club de Ingeniería Codepeques

Sistema web para administrar las mensualidades, los pagos, los patrocinantes y los gastos del Club, con notificaciones programadas a los representantes por correo y WhatsApp.

- **Web:** React + Vite, publicada en Netlify.
- **Base de datos, inicio de sesión y archivos:** Supabase.
- **Envíos:** funciones de Netlify. Una revisa cada hora si hay envíos programados; otra atiende el botón “Enviar ahora”.

## Qué hace

| Sección | Para qué sirve |
|---|---|
| Panel | Cobrado, por cobrar, vencido, patrocinios, gastos, caja disponible y familias con saldo. |
| Estudiantes | Alta y edición. Tres estatus: **activo (70 USD)**, **egresado (140 USD)** y **régimen especial (0 USD)**. Las cuotas se cambian en Configuración. |
| Mensualidades y pagos | Cuadrícula estudiante × mes desde septiembre de 2026. Las mensualidades se crean solas cada mes según el estatus. Se registran pagos completos o parciales, en USD o en Bs con su tasa. |
| Notificaciones | Programas una fecha y hora; el sistema envía a cada familia el estado de cuenta de sus estudiantes y, si hay saldo, la solicitud de pago. Puede repetirse cada mes. Incluye vista previa y envío manual por WhatsApp. |
| Patrocinantes | Datos, logo, contratos (vigencia, monto, forma de pago, contrapartidas, obligaciones y archivo del contrato) y aportes recibidos. |
| Gastos y presupuesto | Gastos por categoría y presupuesto con lo ejecutado. |
| Configuración | Cuotas, día límite de pago, datos de pago y textos de los mensajes, con vista previa. |

Los hermanos con el mismo teléfono (o correo) se tratan como una familia y reciben un solo mensaje.

---

## 1. Crear la base de datos en Supabase

1. Crea una cuenta en <https://supabase.com> y un proyecto nuevo (**New project**). Guarda la contraseña de la base de datos.
2. Ve a **SQL Editor → New query**, pega todo el contenido de `supabase/schema.sql` y pulsa **Run**. Crea las tablas, las reglas de seguridad, los permisos y los espacios para logos y contratos. Puedes volver a ejecutarlo sin perder datos.

   > **Si tu base de datos ya existía** (la creaste antes de esta versión): no vuelvas a cargar `datos-iniciales.sql`. Ejecuta solo `supabase/actualizacion-estatus-por-mes.sql`, que agrega el estatus por mes sin tocar tus datos.
   >
   > Si creaste la base con una versión anterior de este archivo y al entrar ves **“No se pudo conectar”** con el detalle *permission denied*, ejecuta además `supabase/permisos.sql`. Desde 2026, Supabase ya no da acceso automático a las tablas nuevas; ese archivo concede los permisos necesarios.
3. **Cierra el registro público.** En **Authentication**, en la configuración de inicio de sesión (Sign In / Providers), deja activo el proveedor **Email** y desactiva **Allow new users to sign up**. Así nadie puede crearse una cuenta.
4. **Crea tu usuario.** En **Authentication → Users → Add user → Create new user**, escribe tu correo y una contraseña, y marca **Auto Confirm User**.
5. **Hazte administrador.** En el SQL Editor, cambiando el correo por el tuyo:
   ```sql
   insert into public.admins (user_id, nombre)
   select id, 'Henrique Uzcátegui' from auth.users where email = 'tu-correo@ejemplo.com';
   ```
   Para agregar otro administrador más adelante, repite los pasos 4 y 5 con su correo.
6. **Carga los datos del Club.** En el SQL Editor, ejecuta el archivo `datos-iniciales.sql`, que se entrega **aparte** porque contiene datos personales de las familias. Hazlo una sola vez. **Nunca lo subas a GitHub.**
7. **Copia las claves.** En **Project Settings → API Keys**, pestaña de claves publicables y secretas (si ves **Create new API keys**, púlsalo):
   - **Project URL** (también aparece en Project Settings → Data API).
   - **Publishable key** (`sb_publishable_…`): va en la web.
   - **Secret key** (`sb_secret_…`): secreta, solo va en Netlify y en tu `.env`, nunca en el código ni en una variable que empiece con `VITE_`.

   Supabase está retirando las claves antiguas `anon` y `service_role` (las largas que empiezan con `eyJ`). El sistema todavía las acepta, pero usa las nuevas.

## 2. Probar en tu computadora

Requisitos: [Node.js 20 o superior](https://nodejs.org) y [Git](https://git-scm.com).

```bash
cd club-codepeques-gestion
npm install
cp .env.example .env        # en Windows: copy .env.example .env
```

Abre `.env` y completa los valores (ver la sección 5 para el correo).

### Solo la web
```bash
npm run dev
```
Abre <http://localhost:5173> e inicia sesión con el usuario del paso 1.4. Así funciona todo menos los envíos.

### La web con los envíos
```bash
npm install -g netlify-cli
netlify dev
```
Abre <http://localhost:8888>. Ahí funciona el botón **Enviar ahora**. Para ejecutar a mano la revisión que en Netlify corre cada hora:
```bash
netlify functions:invoke enviar-programadas
```

> **Importante al probar:** la base de datos tiene los correos y teléfonos reales de las familias. Antes de probar envíos, crea un estudiante de prueba con **tu** correo y teléfono y programa el envío con “Solo familias con saldo pendiente” después de marcar como pagados a los demás, o mejor, usa un segundo proyecto de Supabase solo para pruebas (repite la sección 1 sin el paso 6).

### Pruebas automáticas de los mensajes
```bash
npm run probar-mensajes
```

## 3. Subir el código a GitHub

1. En GitHub crea un repositorio **privado** (New repository → Private), sin README.
2. En la carpeta del proyecto:
   ```bash
   git init
   git add .
   git commit -m "Sistema de gestión del Club"
   git branch -M main
   git remote add origin https://github.com/ghenrique-dark/club-codepeques-gestion.git
   git push -u origin main
   ```
3. Revisa en GitHub que **no** aparezcan `.env` ni `datos-iniciales.sql`. El archivo `.gitignore` ya los excluye.

## 4. Publicar en Netlify

1. En <https://app.netlify.com>: **Add new site → Import an existing project → GitHub**, y elige el repositorio.
2. Netlify lee `netlify.toml`: comando `npm run build`, carpeta `dist`, funciones en `netlify/functions`. No cambies nada.
3. Antes de publicar, en **Site configuration → Environment variables** agrega **todas** las variables de tu `.env`.
4. **Deploy.** Tendrás una dirección del tipo `https://nombre.netlify.app`.
5. En Supabase, **Authentication → URL Configuration**: pon esa dirección en **Site URL** y agrega `http://localhost:5173` y `http://localhost:8888` en **Redirect URLs**. Es necesario para el enlace de “Olvidé mi contraseña”.
6. Cada `git push` a `main` vuelve a publicar la web sola.

La revisión de envíos programados corre **cada hora en punto**, y solo en el sitio publicado (no en vistas previas de ramas). Un envío programado para las 8:00 sale entre las 8:00 y las 9:00 (hora de Venezuela si programaste desde Venezuela). En **Logs → Functions → enviar-programadas** ves cada ejecución.

## 5. Correo del administrador (Gmail)

Los correos salen desde la cuenta del Club o del administrador, por SMTP:

1. En esa cuenta de Google, activa la **verificación en dos pasos** (Cuenta de Google → Seguridad).
2. En la misma sección, entra a **Contraseñas de aplicaciones** y crea una (nombre: “Sistema Club”). Google muestra 16 letras.
3. En `.env` y en Netlify:
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_USER=correo.del.club@gmail.com
   SMTP_PASS=contraseña-de-aplicacion-de-16-letras
   ```
4. En **Configuración** del sistema, escribe el **correo del administrador**: recibe un resumen después de cada envío, y las respuestas de los padres llegan ahí.

Con otro proveedor (Outlook, el correo de la academia) se usan sus datos SMTP.

## 6. WhatsApp

### Opción A, lista desde el primer día: un toque por familia
Si las variables de WhatsApp están vacías, cada envío programado deja el mensaje de WhatsApp **preparado**. En **Notificaciones → Ver detalle** aparece un botón **Abrir WhatsApp** por familia, con el mensaje ya escrito; solo hay que pulsar Enviar. También está **Envío manual y vista previa** para escribirle a cualquier familia en cualquier momento.

### Opción B: automático con la API oficial de WhatsApp (Meta)
WhatsApp solo permite mensajes automáticos iniciados por la empresa a través de su **WhatsApp Business Platform (Cloud API)**. Exige una cuenta de Meta Business, un número de teléfono dedicado (no puede estar en uso en la app normal de WhatsApp), **plantillas aprobadas por Meta** y tiene **costo por mensaje** según las tarifas de Meta. Resumen:

1. En <https://developers.facebook.com> crea una app de tipo **Business** y agrega el producto **WhatsApp**.
2. Registra y verifica el número del Club, y anota el **Phone number ID**.
3. Crea un **token permanente** (usuario del sistema en Meta Business, con permisos `whatsapp_business_messaging`).
4. En **WhatsApp Manager → Plantillas de mensajes**, crea una plantilla de categoría **Utilidad**, idioma **español**, llamada `estado_cuenta_club`, con este cuerpo:
   ```
   Hola, {{1}}. Le escribimos del Club de Ingeniería Codepeques con el estado de cuenta de {{2}}: {{3}}. Saldo pendiente total: {{4}} USD. Si ya realizó el pago, por favor envíenos el comprobante. ¡Gracias!
   ```
   El sistema llena: {{1}} representante, {{2}} estudiantes, {{3}} resumen por estudiante y {{4}} saldo total.
5. Cuando Meta la apruebe, agrega en Netlify `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE=estado_cuenta_club` y `WHATSAPP_TEMPLATE_LANG=es`, y vuelve a publicar.

Desde ese momento, los envíos con WhatsApp marcado salen solos. Si algo falla, el detalle del envío muestra el error de Meta.

## 7. Uso de cada mes

1. **Al recibir un pago:** Mensualidades y pagos → toca la celda del estudiante y el mes → registra fecha, monto, método y referencia. Un pago de dos meses se registra en cada mes.
2. **Cambio de estatus a partir de un mes** (por ejemplo, de egresado a régimen especial desde octubre): Estudiantes → **Editar** → sección **Estatus por mes** → elige el nuevo estatus y el mes → **Aplicar cambio de estatus**. Las mensualidades desde ese mes se ajustan a la nueva cuota y las anteriores no cambian. Puede ser un mes pasado o futuro, y queda un historial. Si el estudiante ya había pagado más que la nueva cuota, ese mes muestra **saldo a favor**.
3. **Datos del representante:** Estudiantes → **Editar**. Si cambias el nombre, teléfono o correo y el estudiante tiene hermanos registrados, el sistema ofrece aplicar el cambio a todos.
4. **Si alguien deja el Club:** llena “Retirado del Club desde”. Desde ese mes no se le crean mensualidades. Es mejor que eliminarlo, porque se conserva su historial. Para borrarlo por completo (por ejemplo, si se registró por error): **Editar → Eliminar del registro**.
5. **Notificaciones:** programa, por ejemplo, el día 1 a las 8:00 “Todas las familias” (estado de cuenta) con repetición mensual, y el día 6 “Solo con saldo pendiente” (cobro), también mensual.
6. Antes del primer envío, revisa en **Configuración** que los **datos de pago** sean los reales.

## 8. Seguridad y respaldo

- Solo los usuarios de la tabla `admins` ven o modifican datos. Lo controla la base de datos, no solo la web, así que la clave pública (`anon`) no da acceso a nada.
- La `service_role key` y la contraseña SMTP solo viven en Netlify y en tu `.env`.
- Los logos son públicos; los archivos de contratos son privados y se abren con enlaces temporales.
- En el plan gratuito, Supabase pausa los proyectos sin actividad durante un tiempo; la revisión de cada hora mantiene el proyecto activo. Aun así, exporta de vez en cuando las tablas importantes (Table Editor → Export to CSV) como respaldo.

## Estructura

```
supabase/schema.sql                    Base de datos: tablas, reglas de seguridad y funciones
shared/mensajes.js                     Lógica de familias y mensajes (la usan la web y los envíos)
netlify/lib/notificador.mjs            Envío por correo (SMTP) y WhatsApp (Meta)
netlify/functions/enviar-programadas   Se ejecuta cada hora
netlify/functions/enviar-ahora         Botón "Enviar ahora"
src/pages/                             Pantallas de la web
pruebas/                               Pruebas automáticas
```
