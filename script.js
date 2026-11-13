// Referencias a elementos del DOM
const messagesContainer = document.getElementById("chat-messages");
const chatForm = document.getElementById("chat-form");
const userInput = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");
const typingIndicator = document.getElementById("typing-indicator");
const charCount = document.getElementById("char-count");
const cooldownNotice = document.getElementById("cooldown-notice");
const chipButtons = document.querySelectorAll(".chip-btn");

// Configuración y constantes de control
const TIMEOUT_MS = 30000; // 30 segundos límite de respuesta
const COOLDOWN_MS = 1500; // 1,5 segundos de pausa mínima entre envíos
const MAX_CHARS = 500; // Límite de caracteres por mensaje

let isWaiting = false;
let sessionIdMemoria = null;

// Inicializar identificador de sesión único
const SESSION_ID = obtenerSessionId();

// Actualizar contador de caracteres y altura del campo
userInput.addEventListener("input", () => {
  if (userInput.value.length > MAX_CHARS) {
    userInput.value = userInput.value.slice(0, MAX_CHARS);
  }
  charCount.textContent = userInput.value.length;
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 100) + "px";
});

// Manejo de chips de sugerencia rápida
chipButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const query = btn.getAttribute("data-query");
    if (query && !isWaiting) {
      enviarConsulta(query);
    }
  });
});

// Evento de envío del formulario
chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const mensaje = userInput.value.trim();
  if (mensaje && !isWaiting) {
    enviarConsulta(mensaje);
  }
});

// Permite enviar con la tecla Enter (sin Shift)
userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    chatForm.dispatchEvent(new Event("submit"));
  }
});

/**
 * Obtiene o genera un sessionId único y lo persiste en localStorage (con fallback a memoria)
 */
function obtenerSessionId() {
  const claveStorage = "fenix_session_id";
  try {
    const guardado = localStorage.getItem(claveStorage);
    if (guardado) return guardado;
  } catch (e) {
    // localStorage no disponible
  }

  if (sessionIdMemoria) return sessionIdMemoria;

  const nuevoId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `sess_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

  sessionIdMemoria = nuevoId;
  try {
    localStorage.setItem(claveStorage, nuevoId);
  } catch (e) {
    // Ignorar error si el almacenamiento está bloqueado
  }

  return nuevoId;
}

/**
 * Verifica que WEBHOOK_URL tenga una dirección válida configurada
 */
function esWebhookValido() {
  if (typeof WEBHOOK_URL !== "string") return false;
  const url = WEBHOOK_URL.trim();
  return (
    url !== "" &&
    !url.includes("ACA VA") &&
    !url.includes("ejemplo-webhook-prueba")
  );
}

/**
 * Procesa y envía la consulta del usuario hacia Make
 */
async function enviarConsulta(textoOriginal) {
  const mensaje = textoOriginal.trim().slice(0, MAX_CHARS);
  if (!mensaje) return;

  // Limpiar campo de texto
  userInput.value = "";
  charCount.textContent = "0";
  userInput.style.height = "auto";

  // Validar configuración del webhook antes de enviar
  if (!esWebhookValido()) {
    agregarMensajeDOM("error", "Falta pegar la URL de tu webhook en config.js");
    return;
  }

  // Renderizar mensaje del usuario en pantalla
  agregarMensajeDOM("user", mensaje);

  // Bloquear interfaz y activar indicador de carga
  bloquearInterfaz(true);
  mostrarCargando(true);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const respuesta = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: SESSION_ID,
        mensaje: mensaje,
        fecha: new Date().toISOString(),
      }),
      signal: controller.signal,
    });

    const textoCrudo = (await respuesta.text()).trim();

    if (!respuesta.ok) {
      agregarMensajeDOM(
        "error",
        `Make respondió con error (código ${respuesta.status}). Revisá que tu escenario esté en Active o que hayas apretado Run once.`
      );
      return;
    }

    const textoFinal = procesarRespuestaMake(textoCrudo);
    agregarMensajeDOM("agent", textoFinal);
  } catch (error) {
    if (error.name === "AbortError") {
      agregarMensajeDOM(
        "error",
        "Tiempo agotado: Make tardó más de 30 segundos en responder. Intentá de nuevo."
      );
    } else {
      agregarMensajeDOM(
        "error",
        "Error de red: no se pudo conectar con Make. Verificá tu conexión a internet o la URL del webhook."
      );
    }
  } finally {
    clearTimeout(timeoutId);
    mostrarCargando(false);
    iniciarPausaEnvio();
  }
}

/**
 * Analiza la respuesta de Make tolerando Markdown, saltos de línea sin escapar o texto plano
 */
function procesarRespuestaMake(texto) {
  if (!texto) {
    return "(respuesta vacía)";
  }

  // Limpiar envoltorios Markdown (```json ... ```)
  let limpio = texto
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  if (!limpio) {
    return "(respuesta vacía)";
  }

  // Intentar parsear como JSON estándar
  const objetoParseado = intentarParsearJSON(limpio);

  if (objetoParseado !== null) {
    // Si es un objeto válido (no null, no array, no primitivo)
    if (typeof objetoParseado === "object" && !Array.isArray(objetoParseado)) {
      const claves = ["response", "respuesta", "message", "mensaje"];
      for (const clave of claves) {
        const valor = objetoParseado[clave];
        if (typeof valor === "string" && valor.trim() !== "") {
          return valor.trim();
        }
      }
      return "Make respondió, pero sin el campo response";
    }
    // Si es JSON válido pero no un objeto (número, booleano, array, string entre comillas)
    return texto;
  }

  // Si parece un objeto JSON malformado (ej. saltos de línea sin escapar dentro de strings)
  if (limpio.startsWith("{") && limpio.endsWith("}")) {
    const extraido = extraerCampoPorRegex(limpio);
    if (extraido !== null) {
      return extraido;
    }
    return "Make respondió, pero sin el campo response";
  }

  // Texto plano real (ej. "Accepted")
  return texto;
}

/**
 * Intenta analizar un string JSON, reintentando si hay saltos de línea reales dentro de comillas
 */
function intentarParsearJSON(cadena) {
  try {
    return JSON.parse(cadena);
  } catch (e) {
    if (cadena.startsWith("{") && cadena.endsWith("}")) {
      try {
        const escapado = cadena.replace(
          /"((?:\\.|[^"\\])*)"/gs,
          (_, contenido) =>
            `"${contenido.replace(/\r?\n/g, "\\n").replace(/\t/g, "\\t")}"`
        );
        return JSON.parse(escapado);
      } catch (e2) {
        return null;
      }
    }
    return null;
  }
}

/**
 * Extrae el valor de response, respuesta, message o mensaje mediante expresión regular
 */
function extraerCampoPorRegex(cadena) {
  const claves = ["response", "respuesta", "message", "mensaje"];
  for (const clave of claves) {
    const regex = new RegExp(
      `"${clave}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`,
      "s"
    );
    const coincidencia = cadena.match(regex);
    if (coincidencia && coincidencia[1].trim() !== "") {
      return coincidencia[1]
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\")
        .trim();
    }
  }
  return null;
}

/**
 * Agrega un nuevo mensaje a la pantalla usando textContent de forma segura
 */
function agregarMensajeDOM(tipo, texto) {
  const msgDiv = document.createElement("div");
  msgDiv.classList.add("message", tipo);

  const avatar = document.createElement("div");
  avatar.classList.add("avatar");
  avatar.textContent = tipo === "user" ? "U" : "F";

  const bubble = document.createElement("div");
  bubble.classList.add("bubble");
  bubble.style.whiteSpace = "pre-wrap";
  bubble.textContent = texto;

  msgDiv.appendChild(avatar);
  msgDiv.appendChild(bubble);

  messagesContainer.appendChild(msgDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

/**
 * Muestra u oculta el indicador de carga
 */
function mostrarCargando(mostrar) {
  if (mostrar) {
    typingIndicator.classList.remove("hidden");
  } else {
    typingIndicator.classList.add("hidden");
  }
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

/**
 * Deshabilita o habilita los controles de entrada y sugerencias
 */
function bloquearInterfaz(bloquear) {
  isWaiting = bloquear;
  sendBtn.disabled = bloquear;
  userInput.disabled = bloquear;
  chipButtons.forEach((btn) => {
    btn.disabled = bloquear;
  });
}

/**
 * Aplica una pausa mínima de 1,5 segundos entre envíos
 */
function iniciarPausaEnvio() {
  bloquearInterfaz(true);
  cooldownNotice.textContent = "Aguardá un instante...";

  setTimeout(() => {
    cooldownNotice.textContent = "";
    bloquearInterfaz(false);
    userInput.focus();
  }, COOLDOWN_MS);
}
