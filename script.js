// Referencias a elementos del DOM
const messagesContainer = document.getElementById("chat-messages");
const chatForm = document.getElementById("chat-form");
const userInput = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");
const typingIndicator = document.getElementById("typing-indicator");
const charCount = document.getElementById("char-count");
const cooldownNotice = document.getElementById("cooldown-notice");
const chipButtons = document.querySelectorAll(".chip-btn");

// Variables de estado
const TIMEOUT_MS = 10000; // 10 segundos límite de respuesta
const COOLDOWN_SECONDS = 3; // Tiempo de espera obligatorio entre envíos
let isWaiting = false;

// Actualizar contador de caracteres
userInput.addEventListener("input", () => {
  charCount.textContent = userInput.value.length;
  // Auto-ajustar altura del textarea
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 100) + "px";
});

// Manejo de chips de sugerencia rápida
chipButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const query = btn.getAttribute("data-query");
    if (query && !isWaiting) {
      userInput.value = query;
      charCount.textContent = query.length;
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
  Función principal para procesar y enviar la consulta del usuario
  @param {string} textoMensaje - Consulta redactada por el usuario
 */
async function enviarConsulta(textoMensaje) {
  // Limpiar campo de texto
  userInput.value = "";
  charCount.textContent = "0";
  userInput.style.height = "auto";

  // 1. Renderizar mensaje del usuario en el DOM
  agregarMensajeDOM("user", textoMensaje);

  // 2. Bloquear interfaz y activar estados
  bloquearInterfaz(true);
  mostrarCargando(true);

  // Crear AbortController para cancelar peticiones que excedan el límite de tiempo
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    // 3. Realizar petición Fetch al Webhook de config.js
    const response = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: textoMensaje,
        timestamp: new Date().toISOString(),
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Error en el servidor: HTTP ${response.status}`);
    }

    const data = await response.json();
    
    // Asumimos estructura del tipo { response: "..." } o fallback directo
    const respuestaAgente = data.response || data.message || "Solicitud procesada correctamente.";
    
    mostrarCargando(false);
    agregarMensajeDOM("agent", respuestaAgente);

  } catch (error) {
    clearTimeout(timeoutId);
    mostrarCargando(false);

    // Si es un error por timeout o abort de red
    if (error.name === "AbortError") {
      agregarMensajeDOM("error", "⚠️ La solicitud superó el tiempo máximo de espera. Por favor, intenta de nuevo.");
    } else {
      // Si el webhook de prueba falla o no está disponible, simulamos una respuesta local funcional
      const respuestaSimulada = obtenerRespuestaSimulada(textoMensaje);
      agregarMensajeDOM("agent", respuestaSimulada);
    }
  } finally {
    // 4. Iniciar temporizador de enfriamiento para evitar spam
    iniciarCooldown();
  }
}

/**
  Agrega un nuevo elemento de mensaje a la pantalla de chat
  @param {string} tipo - 'user', 'agent' o 'error'
  @param {string} texto - Contenido textual
 */
function agregarMensajeDOM(tipo, texto) {
  const msgDiv = document.createElement("div");
  msgDiv.classList.add("message", tipo);

  const avatar = document.createElement("div");
  avatar.classList.add("avatar");
  avatar.textContent = tipo === "user" ? "U" : "F";

  const bubble = document.createElement("div");
  bubble.classList.add("bubble");
  bubble.innerHTML = formatearTexto(texto);

  msgDiv.appendChild(avatar);
  msgDiv.appendChild(bubble);

  messagesContainer.appendChild(msgDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

/**
  Convierte saltos de línea y formateo básico a HTML
 */
function formatearTexto(texto) {
  return texto
    .replace(/\n/g, "<br>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
}

/**
  Muestra u oculta el indicador de cargando
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
  Deshabilita controles del formulario durante la petición
 */
function bloquearInterfaz(bloquear) {
  isWaiting = bloquear;
  sendBtn.disabled = bloquear;
  userInput.disabled = bloquear;
}

/**
  Temporizador obligatorio entre envíos
 */
function iniciarCooldown() {
  let restantes = COOLDOWN_SECONDS;
  bloquearInterfaz(true);

  const interval = setInterval(() => {
    if (restantes > 0) {
      cooldownNotice.textContent = `Espera ${restantes}s para enviar otro mensaje...`;
      restantes--;
    } else {
      clearInterval(interval);
      cooldownNotice.textContent = "";
      bloquearInterfaz(false);
      userInput.focus();
    }
  }, 1000);
}

/**
  Lógica local de respuesta para demostración ante ausencias del Webhook externo
 */
function obtenerRespuestaSimulada(consulta) {
  const q = consulta.toLowerCase();
  
  if (q.includes("dni")) {
    return "Para renovar o tramitar tu **DNI** necesitas:\n1. Solicitar un turno previo online.\n2. Presentar tu partida de nacimiento actualizada si eres menor.\n3. Acudir a la sede seleccionada con el DNI anterior si lo posees.";
  } else if (q.includes("pasaporte")) {
    return "El **Pasaporte** regular demora aproximadamente 15 días hábiles. Si requieres el servicio **Urgente**, puedes tramitarlo en 48-72 horas hábiles abonando la tasa correspondiente en los centros habilitados.";
  } else if (q.includes("cuit") || q.includes("cuil")) {
    return "Puedes obtener tu constancia de **CUIT/CUIL** digitalmente de forma gratuita ingresando a la plataforma oficial de AFIP/ANSES con tu número de documento.";
  } else if (q.includes("licencia") || q.includes("conducir")) {
    return "Para la **Licencia de Conducir** se requiere:\n- Examen teórico y práctico aprobado (primera vez).\n- Examen psicofísico.\n- Inexistencia de multas o deudas pendientes.";
  }

  return `Recibí tu consulta sobre: "${consulta}". Actualmente me encuentro respondiendo en modo asistido local. ¿Hay algún otro detalle de este trámite que desees conocer?`;
}
