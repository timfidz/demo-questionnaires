// Relais (démonstration) : questionnaires partagés par lien et QR code, suivi des réponses en trois colonnes, contacts
// créés tout seuls avec détection des doublons. Sans serveur : tout est gardé dans ce navigateur (localStorage).
// Adresses : #/questionnaires, #/questionnaires/<id> (édition), #/suivi, #/contacts, #/contacts/<id>,
// #/r/<id>.<questionnaire emballé> (le questionnaire public, celui du lien et du QR code).
/* global qrcode */
"use strict"

const CLE = "relais-demo-v1"
const UTILISATEURS = [
  { id: "camille", nom: "Camille", couleur: "#0f766e" },
  { id: "julien", nom: "Julien", couleur: "#6d28d9" },
  { id: "sarah", nom: "Sarah", couleur: "#b45309" },
]
const TYPES = {
  nom: { lib: "Nom et prénom", contact: true },
  email: { lib: "E-mail", contact: true },
  tel: { lib: "Téléphone", contact: true },
  court: { lib: "Texte court" },
  long: { lib: "Texte long" },
  unique: { lib: "Choix unique", options: true },
  multiple: { lib: "Choix multiples", options: true },
  liste: { lib: "Liste déroulante", options: true },
  date: { lib: "Date" },
  nombre: { lib: "Nombre" },
}
const STATUTS = [
  { id: "nouvelle", lib: "Nouvelle demande" },
  { id: "encours", lib: "En cours" },
  { id: "traite", lib: "Traité" },
]

// ---------- outils ----------
const uid = () => Math.random().toString(36).slice(2, 9)
const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])
const normEmail = (e) => (e || "").trim().toLowerCase()
const normTel = (t) => {
  let d = (t || "").replace(/\D/g, "")
  if (d.startsWith("33") && d.length === 11) d = "0" + d.slice(2)
  return d
}
const normNom = (n) => (n || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim()
const utilisateur = (id) => UTILISATEURS.find((u) => u.id === id)
const statut = (id) => STATUTS.find((s) => s.id === id)

function quand(t) {
  const min = Math.round((Date.now() - t) / 60000)
  if (min < 1) return "à l'instant"
  if (min < 60) return `il y a ${min} min`
  const hres = Math.round(min / 60)
  if (hres < 24) return `il y a ${hres} h`
  if (hres < 48) return "hier"
  return "le " + new Date(t).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
}
const dateLongue = (t) => new Date(t).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" })

function avatar(id, taille = "") {
  const u = utilisateur(id)
  if (!u) return `<span class="avatar vide ${taille}" title="Non attribuée" aria-hidden="true">?</span>`
  return `<span class="avatar ${taille}" style="background:${u.couleur}" title="${h(u.nom)}" aria-hidden="true">${h(u.nom[0])}</span>`
}

// ---------- stockage ----------
function lire() {
  try { const t = localStorage.getItem(CLE); if (t) return JSON.parse(t) } catch {}
  return null
}
function ecrire() {
  try { localStorage.setItem(CLE, JSON.stringify(etat)) } catch {}
}

// ---------- contacts : rattachement et doublons ----------
function coordonnees(q, valeurs) {
  const c = { nom: "", email: "", tel: "" }
  for (const x of q.questions) {
    const v = (valeurs[x.id] || "").toString().trim()
    if (v && TYPES[x.type].contact && !c[x.type]) c[x.type] = v
  }
  return c
}

function correspond(k, em, te) {
  const emails = [k.email, ...(k.autres || []).map((a) => a.email)].map(normEmail).filter(Boolean)
  const tels = [k.tel, ...(k.autres || []).map((a) => a.tel)].map(normTel).filter(Boolean)
  return (em && emails.includes(em)) || (te && tels.includes(te))
}

function rattacher(e, c) {
  const em = normEmail(c.email), te = normTel(c.tel)
  let k = (em || te) ? e.contacts.find((x) => correspond(x, em, te)) : null
  if (k) {
    if (!k.nom && c.nom) k.nom = c.nom
    if (!k.email && c.email) k.email = c.email
    if (!k.tel && c.tel) k.tel = c.tel
    return { contact: k, existant: true }
  }
  if (!em && !te && !c.nom) return { contact: null, existant: false }
  k = { id: uid(), nom: c.nom || "(sans nom)", email: c.email, tel: c.tel, autres: [], cree: Date.now() }
  e.contacts.push(k)
  return { contact: k, existant: false }
}

function enregistrer(e, q, valeurs, opts = {}) {
  const { contact, existant } = rattacher(e, coordonnees(q, valeurs))
  const r = {
    id: uid(), qid: q.id, date: opts.date || Date.now(), valeurs,
    statut: opts.statut || "nouvelle", assigne: opts.assigne || null,
    contactId: contact ? contact.id : null, connu: existant,
  }
  e.reponses.push(r)
  return r
}

// Fiches au même nom sans e-mail ni téléphone commun : peut-être la même personne, on demande avant de fusionner
function doublonsPossibles() {
  const groupes = {}
  for (const k of etat.contacts) {
    const n = normNom(k.nom)
    if (n && n !== "(sans nom)") (groupes[n] = groupes[n] || []).push(k)
  }
  return Object.values(groupes).filter((g) => g.length > 1 && !etat.distincts.includes(g.map((k) => k.id).sort().join("+")))
}

function fusionner(ids) {
  const fiches = ids.map((id) => etat.contacts.find((k) => k.id === id)).filter(Boolean).sort((a, b) => a.cree - b.cree)
  const [garde, ...autres] = fiches
  for (const k of autres) {
    if (!garde.email && k.email) garde.email = k.email
    else if (k.email && normEmail(k.email) !== normEmail(garde.email)) garde.autres.push({ email: k.email })
    if (!garde.tel && k.tel) garde.tel = k.tel
    else if (k.tel && normTel(k.tel) !== normTel(garde.tel)) garde.autres.push({ tel: k.tel })
    garde.autres.push(...(k.autres || []))
    for (const r of etat.reponses) if (r.contactId === k.id) r.contactId = garde.id
    etat.contacts = etat.contacts.filter((x) => x.id !== k.id)
  }
  return garde
}

// ---------- données d'exemple ----------
function graine() {
  const e = { questionnaires: [], reponses: [], contacts: [], distincts: [], moi: "camille", derniere: null }
  const devis = {
    id: "devis", titre: "Demande de devis", cree: Date.now() - 20 * 86400000,
    description: "Décrivez votre besoin : nous revenons vers vous sous 48 heures.",
    questions: [
      { id: "a1", type: "nom", libelle: "Nom et prénom", obligatoire: true },
      { id: "a2", type: "email", libelle: "E-mail", obligatoire: true },
      { id: "a3", type: "tel", libelle: "Téléphone", obligatoire: false },
      { id: "a4", type: "unique", libelle: "Type de prestation", obligatoire: true, options: ["Installation", "Entretien", "Dépannage", "Autre"] },
      { id: "a5", type: "multiple", libelle: "Vous souhaitez aussi", obligatoire: false, options: ["Une visite sur place", "Un devis détaillé par poste", "Une intervention le samedi"] },
      { id: "a6", type: "date", libelle: "Date souhaitée", obligatoire: false },
      { id: "a7", type: "nombre", libelle: "Surface concernée (m²)", obligatoire: false },
      { id: "a8", type: "long", libelle: "Votre demande", obligatoire: true },
    ],
  }
  const atelier = {
    id: "atelier", titre: "Inscription à l'atelier découverte", cree: Date.now() - 12 * 86400000,
    description: "Une heure pour découvrir nos services. Gratuit, places limitées.",
    questions: [
      { id: "b1", type: "nom", libelle: "Nom et prénom", obligatoire: true },
      { id: "b2", type: "email", libelle: "E-mail", obligatoire: false },
      { id: "b3", type: "tel", libelle: "Téléphone", obligatoire: true },
      { id: "b4", type: "liste", libelle: "Séance", obligatoire: true, options: ["Mardi 14 h", "Jeudi 18 h", "Samedi 10 h"] },
      { id: "b5", type: "nombre", libelle: "Nombre de participants", obligatoire: true },
      { id: "b6", type: "unique", libelle: "Comment nous avez-vous connus ?", obligatoire: false, options: ["Bouche-à-oreille", "Réseaux sociaux", "Recherche Google", "Salon"] },
      { id: "b7", type: "court", libelle: "Une remarque ?", obligatoire: false },
    ],
  }
  e.questionnaires.push(devis, atelier)
  const H = 3600000, t = Date.now()
  const jour = (j) => new Date(t + j * 86400000).toISOString().slice(0, 10)
  enregistrer(e, devis, { a1: "Thomas Girard", a2: "thomas.girard@example.com", a3: "06 39 98 10 21", a4: "Installation", a5: ["Une visite sur place"], a6: jour(9), a7: "85", a8: "Installation complète dans un local commercial, à faire avant la fin du mois." }, { date: t - 96 * H, statut: "traite", assigne: "sarah" })
  enregistrer(e, devis, { a1: "Karim Benali", a2: "k.benali@example.com", a3: "", a4: "Entretien", a5: ["Un devis détaillé par poste"], a6: "", a7: "", a8: "Contrat d'entretien annuel pour deux sites. Pouvez-vous m'appeler ?" }, { date: t - 52 * H, statut: "encours", assigne: "julien" })
  enregistrer(e, atelier, { b1: "Nadia Roux", b2: "nadia.roux@example.com", b3: "06 39 98 44 07", b4: "Jeudi 18 h", b5: "2", b6: "Salon", b7: "" }, { date: t - 30 * H, statut: "encours", assigne: "camille" })
  enregistrer(e, devis, { a1: "Léa Martin", a2: "lea.martin@example.com", a3: "06 39 98 52 60", a4: "Dépannage", a5: [], a6: jour(2), a7: "", a8: "Panne depuis ce matin, c'est assez urgent." }, { date: t - 20 * H })
  enregistrer(e, atelier, { b1: "Lea MARTIN", b2: "", b3: "+33 6 39 98 52 60", b4: "Samedi 10 h", b5: "1", b6: "Recherche Google", b7: "Je viendrai avec une collègue si possible." }, { date: t - 6 * H })
  enregistrer(e, devis, { a1: "Thomas Girard", a2: "t.girard@example.org", a3: "", a4: "Autre", a5: ["Une intervention le samedi"], a6: "", a7: "", a8: "Même adresse que la dernière fois, pour un second local." }, { date: t - 3 * H })
  enregistrer(e, atelier, { b1: "Sophie Lefèvre", b2: "sophie.lefevre@example.com", b3: "06 39 98 73 15", b4: "Mardi 14 h", b5: "3", b6: "Bouche-à-oreille", b7: "" }, { date: t - 40 * 60000 })
  return e
}

let etat = lire() || graine()

// ---------- lien public et QR code ----------
const CODES = { nom: "n", email: "e", tel: "t", court: "c", long: "l", unique: "u", multiple: "m", liste: "s", date: "d", nombre: "x" }
const TYPE_DE = Object.fromEntries(Object.entries(CODES).map(([k, v]) => [v, k]))
function b64url(s) {
  let bin = ""
  new TextEncoder().encode(s).forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}
function deb64url(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"))
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}
// Le questionnaire voyage dans le lien : il s'ouvre ainsi sur un autre appareil (le téléphone qui scanne), sans serveur.
function emballer(q) {
  return b64url(JSON.stringify([q.titre, q.description || "", q.questions.map((x) => [CODES[x.type], x.libelle, x.obligatoire ? 1 : 0, ...(TYPES[x.type].options ? x.options || [] : [])])]))
}
function deballer(id, s) {
  const [titre, description, qs] = JSON.parse(deb64url(s))
  return { id, titre, description, cree: Date.now(), questions: qs.map((a, i) => ({ id: "p" + i, type: TYPE_DE[a[0]] || "court", libelle: a[1], obligatoire: !!a[2], options: a.slice(3) })) }
}
// Un questionnaire d'exemple non modifié existe sur tous les appareils : lien court, QR code peu dense, facile à scanner
const EXEMPLES = Object.fromEntries(graine().questionnaires.map((q) => [q.id, emballer(q)]))
const lienPublic = (q) => location.href.split("#")[0] + "#/r/" + q.id + (EXEMPLES[q.id] === emballer(q) ? "" : "." + emballer(q))

function qrModules(texte) {
  const qr = qrcode(0, "L")
  qr.addData(texte)
  qr.make()
  return qr
}
function qrSvg(texte) {
  const qr = qrModules(texte), n = qr.getModuleCount(), m = 4
  let d = ""
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) d += `M${x + m} ${y + m}h1v1h-1z`
  return `<svg class="qr" viewBox="0 0 ${n + 2 * m} ${n + 2 * m}" role="img" aria-label="QR code du questionnaire" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#111"/></svg>`
}
function qrPng(texte) {
  const qr = qrModules(texte), n = qr.getModuleCount(), m = 4, c = 10
  const cv = document.createElement("canvas")
  cv.width = cv.height = (n + 2 * m) * c
  const g = cv.getContext("2d")
  g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height); g.fillStyle = "#111"
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) g.fillRect((x + m) * c, (y + m) * c, c, c)
  return cv.toDataURL("image/png")
}
const slug = (s) => normNom(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "questionnaire"

// ---------- formulaire (public et aperçu) ----------
function champ(q, x, prefixe) {
  const id = `${prefixe}-${x.id}`
  const etoile = x.obligatoire ? ' <span class="obl" aria-hidden="true">*</span>' : ""
  const req = x.obligatoire ? ' aria-required="true"' : ""
  const lib = h(x.libelle || "Question sans intitulé")
  const err = `<p class="erreur" id="${id}-err" hidden></p>`
  const opts = (x.options || []).filter((o) => o.trim())
  if (x.type === "unique" || x.type === "multiple") {
    const t = x.type === "unique" ? "radio" : "checkbox"
    return `<fieldset class="champ" data-qid="${x.id}" aria-describedby="${id}-err"><legend>${lib}${etoile}</legend>
      ${opts.map((o, i) => `<label class="choix"><input type="${t}" name="${id}" value="${h(o)}" id="${id}-${i}"> ${h(o)}</label>`).join("")}
      ${opts.length ? "" : '<p class="aide">Aucun choix pour l\'instant.</p>'}${err}</fieldset>`
  }
  let entree
  if (x.type === "long") entree = `<textarea id="${id}" name="${id}" rows="4"${req} aria-describedby="${id}-err"></textarea>`
  else if (x.type === "liste") entree = `<select id="${id}" name="${id}"${req} aria-describedby="${id}-err"><option value="">Choisir…</option>${opts.map((o) => `<option>${h(o)}</option>`).join("")}</select>`
  else {
    const t = { email: "email", tel: "tel", date: "date", nombre: "number" }[x.type] || "text"
    const auto = { nom: ' autocomplete="name"', email: ' autocomplete="email"', tel: ' autocomplete="tel"' }[x.type] || ""
    entree = `<input type="${t}" id="${id}" name="${id}"${auto}${t === "number" ? ' inputmode="decimal"' : ""}${req} aria-describedby="${id}-err">`
  }
  return `<div class="champ" data-qid="${x.id}"><label for="${id}">${lib}${etoile}</label>${entree}${err}</div>`
}

function formulaire(q, prefixe) {
  return `<h1 class="f-titre">${h(q.titre || "Questionnaire sans titre")}</h1>
    ${q.description ? `<p class="f-desc">${h(q.description)}</p>` : ""}
    ${q.questions.some((x) => x.obligatoire) ? '<p class="aide">Les champs marqués <span class="obl">*</span> sont obligatoires.</p>' : ""}
    ${q.questions.map((x) => champ(q, x, prefixe)).join("")}`
}

function lireFormulaire(form, q, prefixe) {
  const valeurs = {}, erreurs = []
  for (const x of q.questions) {
    const id = `${prefixe}-${x.id}`
    let v
    if (x.type === "multiple") v = [...form.querySelectorAll(`input[name="${id}"]:checked`)].map((i) => i.value)
    else if (x.type === "unique") v = (form.querySelector(`input[name="${id}"]:checked`) || {}).value || ""
    else v = (form.querySelector(`#${id}`) || {}).value?.trim() || ""
    valeurs[x.id] = v
    let msg = ""
    const vide = Array.isArray(v) ? v.length === 0 : !v
    if (x.obligatoire && vide) msg = x.type === "multiple" ? "Cochez au moins un choix." : "Ce champ est obligatoire."
    else if (!vide && x.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) msg = "Cette adresse e-mail ne semble pas valide."
    else if (!vide && x.type === "tel" && normTel(v).length < 9) msg = "Ce numéro semble incomplet."
    else if (!vide && x.type === "nombre" && isNaN(Number(v.replace(",", ".")))) msg = "Indiquez un nombre."
    const p = form.querySelector(`#${id}-err`)
    if (p) { p.textContent = msg; p.hidden = !msg }
    const el = form.querySelector(`#${id}`) || form.querySelector(`[data-qid="${x.id}"]`)
    if (el) el.setAttribute("aria-invalid", msg ? "true" : "false")
    if (msg) erreurs.push(id)
  }
  return { valeurs, erreurs }
}

// ---------- routes ----------
const route = () => (location.hash.replace(/^#\/?/, "") || "questionnaires").split("/")
const app = document.getElementById("app")
const dialogue = document.getElementById("dialogue")

function rendre() {
  const [section, param] = route()
  document.body.classList.toggle("mode-public", section === "r")
  if (section === "r") return rendrePublic(param || "")
  const nouvelles = etat.reponses.filter((r) => r.statut === "nouvelle").length
  const lien = (s, lib, extra = "") => `<a href="#/${s}"${section === s ? ' aria-current="page"' : ""}>${lib}${extra}</a>`
  let corps
  if (section === "questionnaires" && param) corps = vueEdition(param)
  else if (section === "suivi") corps = vueSuivi()
  else if (section === "contacts" && param) corps = vueContact(param)
  else if (section === "contacts") corps = vueContacts()
  else corps = vueQuestionnaires()
  app.innerHTML = `
    <header class="barre">
      <a class="marque" href="#/questionnaires"><img src="favicon.svg" alt="" width="28" height="28"> Relais</a>
      <nav aria-label="Sections">
        ${lien("questionnaires", "Questionnaires")}
        ${lien("suivi", "Suivi", nouvelles ? ` <span class="pastille">${nouvelles}<span class="sr"> nouvelle${nouvelles > 1 ? "s" : ""}</span></span>` : "")}
        ${lien("contacts", "Contacts")}
      </nav>
      <label class="moi">Vous êtes
        <select id="moi">${UTILISATEURS.map((u) => `<option value="${u.id}"${u.id === etat.moi ? " selected" : ""}>${h(u.nom)}</option>`).join("")}</select>
      </label>
    </header>
    <p class="bandeau">Démonstration : personnes et données inventées, gardées dans ce navigateur seulement.
      <button type="button" class="lien-bouton" data-action="reinit">Remettre la démo à zéro</button></p>
    <main id="contenu" tabindex="-1">${corps}</main>`
  if (section === "questionnaires" && param) majApercu()
}

// ---------- vue : liste des questionnaires ----------
function vueQuestionnaires() {
  const cartes = etat.questionnaires.map((q) => {
    const rep = etat.reponses.filter((r) => r.qid === q.id)
    const nv = rep.filter((r) => r.statut === "nouvelle").length
    return `<li class="carte-q">
      <h2><a href="#/questionnaires/${q.id}">${h(q.titre || "Questionnaire sans titre")}</a></h2>
      <p class="meta">${q.questions.length} question${q.questions.length > 1 ? "s" : ""} · ${rep.length} réponse${rep.length > 1 ? "s" : ""}${nv ? ` · <strong>${nv} nouvelle${nv > 1 ? "s" : ""}</strong>` : ""}</p>
      <div class="actions">
        <a class="btn" href="#/questionnaires/${q.id}">Modifier</a>
        <button type="button" class="btn" data-action="partager" data-id="${q.id}">Lien et QR code</button>
        <a class="btn" href="${h(lienPublic(q))}" target="_blank" rel="noopener">Ouvrir<span class="sr"> le questionnaire ${h(q.titre)} dans un nouvel onglet</span></a>
      </div></li>`
  }).join("")
  return `<div class="entete"><h1>Questionnaires</h1>
      <button type="button" class="btn primaire" data-action="nouveau-q">Nouveau questionnaire</button></div>
    <ol class="essai">
      <li><strong>Ouvrez un questionnaire</strong> (bouton « Ouvrir ») ou scannez son QR code, et répondez.</li>
      <li>La réponse arrive dans <a href="#/suivi">Suivi</a>, colonne « Nouvelle demande ».</li>
      <li>La fiche est créée dans <a href="#/contacts">Contacts</a>, ou complétée si la personne est déjà connue.</li>
    </ol>
    <ul class="grille-q">${cartes}</ul>`
}

// ---------- vue : édition ----------
function vueEdition(id) {
  const q = etat.questionnaires.find((x) => x.id === id)
  if (!q) return `<h1>Questionnaire introuvable</h1><p><a href="#/questionnaires">Retour aux questionnaires</a></p>`
  const groupe = (cles) => cles.map((k) => `<option value="${k}">${TYPES[k].lib}</option>`).join("")
  const blocs = q.questions.map((x, i) => {
    const sel = `<optgroup label="Coordonnées (remplissent la fiche contact)">${groupe(["nom", "email", "tel"])}</optgroup><optgroup label="Réponses">${groupe(["court", "long", "unique", "multiple", "liste", "date", "nombre"])}</optgroup>`
      .replace(`value="${x.type}"`, `value="${x.type}" selected`)
    return `<li class="bloc-q" data-qid="${x.id}">
      <div class="bloc-ligne">
        <span class="num" aria-hidden="true">${i + 1}</span>
        <label class="grand">Question ${i + 1}<input type="text" data-champ="libelle" value="${h(x.libelle)}" placeholder="Intitulé de la question"></label>
        <label>Type<select data-champ="type">${sel}</select></label>
      </div>
      ${TYPES[x.type].options ? `<label class="options">Choix proposés, un par ligne<textarea data-champ="options" rows="${Math.max(3, (x.options || []).length + 1)}">${h((x.options || []).join("\n"))}</textarea></label>` : ""}
      <div class="bloc-pied">
        <label class="case"><input type="checkbox" data-champ="obligatoire"${x.obligatoire ? " checked" : ""}> Obligatoire</label>
        ${TYPES[x.type].contact ? '<span class="etiquette">va dans la fiche contact</span>' : ""}
        <span class="espace"></span>
        <button type="button" class="icone" data-action="monter" aria-label="Monter la question ${i + 1}"${i === 0 ? " disabled" : ""}>↑</button>
        <button type="button" class="icone" data-action="descendre" aria-label="Descendre la question ${i + 1}"${i === q.questions.length - 1 ? " disabled" : ""}>↓</button>
        <button type="button" class="lien-bouton danger" data-action="suppr-question" aria-label="Supprimer la question ${i + 1}">Supprimer</button>
      </div></li>`
  }).join("")
  return `<p class="fil"><a href="#/questionnaires">← Questionnaires</a></p>
    <div class="entete"><h1>Modifier le questionnaire</h1>
      <div class="actions">
        <button type="button" class="btn" data-action="partager" data-id="${q.id}">Lien et QR code</button>
        <a class="btn" href="${h(lienPublic(q))}" target="_blank" rel="noopener" id="ouvrir-public">Ouvrir<span class="sr"> le questionnaire dans un nouvel onglet</span></a>
      </div></div>
    <div class="edition" data-q="${q.id}">
      <section class="editeur" aria-label="Questions">
        <label class="grand">Titre<input type="text" data-champ-q="titre" value="${h(q.titre)}"></label>
        <label class="grand">Présentation (facultatif)<textarea data-champ-q="description" rows="2">${h(q.description)}</textarea></label>
        <ol class="blocs">${blocs}</ol>
        <div class="ajout">
          <button type="button" class="btn primaire" data-action="ajout-question">Ajouter une question</button>
          <span class="aide" id="enregistre">Enregistré automatiquement.</span>
        </div>
        <p><button type="button" class="lien-bouton danger" data-action="suppr-q">Supprimer ce questionnaire</button></p>
      </section>
      <section class="apercu" aria-labelledby="apercu-titre">
        <h2 id="apercu-titre">Aperçu, tel que le voient les répondants</h2>
        <div class="telephone"><form class="formulaire" id="apercu" novalidate></form></div>
      </section>
    </div>`
}

function majApercu() {
  const zone = document.querySelector(".edition")
  if (!zone) return
  const q = etat.questionnaires.find((x) => x.id === zone.dataset.q)
  document.getElementById("apercu").innerHTML = formulaire(q, "ap") + '<button type="button" class="btn primaire large" disabled>Envoyer</button>'
  const o = document.getElementById("ouvrir-public")
  if (o) o.href = lienPublic(q)
}

// ---------- vue : suivi ----------
let filtreQ = "", filtreA = ""
function carte(r) {
  const k = etat.contacts.find((c) => c.id === r.contactId)
  const q = etat.questionnaires.find((x) => x.id === r.qid)
  const i = STATUTS.findIndex((s) => s.id === r.statut)
  const suivant = STATUTS[i + 1]
  const u = utilisateur(r.assigne)
  return `<li class="carte${etat.derniere === r.id ? " neuve" : ""}" draggable="true" data-rid="${r.id}">
    <button type="button" class="carte-ouvrir" data-action="ouvrir-r" data-id="${r.id}">
      <strong>${h(k ? k.nom : "Réponse anonyme")}</strong>
      <span class="meta">${h(q ? q.titre : "")}</span>
      <span class="meta">${quand(r.date)}${k && (k.email || k.tel) ? " · " + h(k.email || k.tel) : ""}</span>
    </button>
    <div class="carte-pied">
      ${avatar(r.assigne, "petit")}<span class="meta">${u ? h(u.nom) : "Non attribuée"}</span>
      ${r.connu ? '<span class="etiquette">contact déjà connu</span>' : ""}
      <span class="espace"></span>
      ${suivant ? `<button type="button" class="icone" data-action="avancer" data-id="${r.id}" aria-label="Passer à « ${suivant.lib} »" title="Passer à « ${suivant.lib} »">→</button>` : ""}
    </div></li>`
}
function vueSuivi() {
  const moi = etat.moi
  const liste = etat.reponses
    .filter((r) => !filtreQ || r.qid === filtreQ)
    .filter((r) => !filtreA || (filtreA === "aucun" ? !r.assigne : r.assigne === (filtreA === "moi" ? moi : filtreA)))
    .sort((a, b) => b.date - a.date)
  const colonnes = STATUTS.map((s) => {
    const rs = liste.filter((r) => r.statut === s.id)
    return `<section class="colonne" aria-labelledby="col-${s.id}">
      <h2 id="col-${s.id}">${s.lib} <span class="compte">${rs.length}</span></h2>
      <ul class="cartes" data-statut="${s.id}">${rs.map(carte).join("") || '<li class="vide">Aucune demande</li>'}</ul></section>`
  }).join("")
  return `<div class="entete"><h1>Suivi des demandes</h1>
      <div class="filtres">
        <label>Questionnaire<select id="filtre-q"><option value="">Tous</option>${etat.questionnaires.map((q) => `<option value="${q.id}"${filtreQ === q.id ? " selected" : ""}>${h(q.titre)}</option>`).join("")}</select></label>
        <label>Attribuées à<select id="filtre-a">
          <option value="">Tout le monde</option><option value="moi"${filtreA === "moi" ? " selected" : ""}>Moi</option><option value="aucun"${filtreA === "aucun" ? " selected" : ""}>Personne</option>
          ${UTILISATEURS.map((u) => `<option value="${u.id}"${filtreA === u.id ? " selected" : ""}>${h(u.nom)}</option>`).join("")}</select></label>
      </div></div>
    <p class="aide">Glissez une carte d'une colonne à l'autre, ou ouvrez-la pour changer son statut et la personne qui la traite.</p>
    <div class="kanban">${colonnes}</div>`
}

function ouvrirReponse(id) {
  const r = etat.reponses.find((x) => x.id === id)
  if (!r) return
  const q = etat.questionnaires.find((x) => x.id === r.qid)
  const k = etat.contacts.find((c) => c.id === r.contactId)
  const valeur = (v) => Array.isArray(v) ? (v.length ? v.map(h).join(", ") : "—") : (v ? h(v).replace(/\n/g, "<br>") : "—")
  dialogue.innerHTML = `<form method="dialog" class="dlg">
    <div class="dlg-tete"><h2 id="dialogue-titre">${h(k ? k.nom : "Réponse anonyme")}</h2><button class="icone" value="fermer" aria-label="Fermer">✕</button></div>
    <p class="meta">${h(q ? q.titre : "")} · reçue ${quand(r.date)} (${dateLongue(r.date)})</p>
    <div class="dlg-reglages">
      <label>Statut<select data-maj="statut" data-id="${r.id}">${STATUTS.map((s) => `<option value="${s.id}"${s.id === r.statut ? " selected" : ""}>${s.lib}</option>`).join("")}</select></label>
      <label>Traitée par<select data-maj="assigne" data-id="${r.id}"><option value="">Personne</option>${UTILISATEURS.map((u) => `<option value="${u.id}"${u.id === r.assigne ? " selected" : ""}>${h(u.nom)}</option>`).join("")}</select></label>
    </div>
    ${k ? `<p><a href="#/contacts/${k.id}" data-action="fermer-dlg">Voir la fiche contact de ${h(k.nom)} →</a>${r.connu ? ' <span class="etiquette">contact déjà connu : réponse rattachée à sa fiche</span>' : ""}</p>` : ""}
    <h3>Réponses</h3>
    <dl class="reponses">${q ? q.questions.map((x) => `<dt>${h(x.libelle)}</dt><dd>${valeur(r.valeurs[x.id])}</dd>`).join("") : ""}</dl>
  </form>`
  if (!dialogue.open) dialogue.showModal()
}

function changer(id, champ, valeur) {
  const r = etat.reponses.find((x) => x.id === id)
  if (!r) return
  r[champ] = valeur || null
  if (champ === "statut" && !valeur) r.statut = "nouvelle"
  etat.derniere = null
  ecrire()
  rendre()
}

// ---------- vue : contacts ----------
let recherche = ""
function vueContacts() {
  const doublons = doublonsPossibles()
  const n = normNom(recherche)
  const liste = etat.contacts
    .filter((k) => !n || normNom([k.nom, k.email, k.tel].join(" ")).includes(n))
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr"))
  const lignes = liste.map((k) => {
    const rs = etat.reponses.filter((r) => r.contactId === k.id)
    const derniere = rs.length ? Math.max(...rs.map((r) => r.date)) : k.cree
    return `<tr><th scope="row"><a href="#/contacts/${k.id}">${h(k.nom)}</a></th><td>${h(k.email) || "—"}</td><td>${h(k.tel) || "—"}</td><td>${rs.length}</td><td>${quand(derniere)}</td></tr>`
  }).join("")
  return `<div class="entete"><h1>Contacts</h1>
      <label class="recherche">Rechercher<input type="search" id="recherche" value="${h(recherche)}" placeholder="Nom, e-mail ou téléphone"></label></div>
    ${doublons.map((g) => `<div class="alerte" role="note"><p><strong>Doublon possible :</strong> ${g.length} fiches « ${h(g[0].nom)} » sans e-mail ni téléphone en commun (${g.map((k) => h(k.email || k.tel || "sans coordonnées")).join(" et ")}).</p>
      <div class="actions"><button type="button" class="btn primaire" data-action="fusionner" data-ids="${g.map((k) => k.id).join("+")}">Fusionner les fiches</button>
      <button type="button" class="btn" data-action="distincts" data-ids="${g.map((k) => k.id).sort().join("+")}">Ce sont des personnes différentes</button></div></div>`).join("")}
    <p class="aide">Une réponse avec un e-mail ou un téléphone déjà connu est rattachée à la fiche existante (le téléphone est comparé chiffre à chiffre, +33 compris).</p>
    <div class="tableau"><table><thead><tr><th scope="col">Nom</th><th scope="col">E-mail</th><th scope="col">Téléphone</th><th scope="col">Demandes</th><th scope="col">Dernière</th></tr></thead>
    <tbody>${lignes || '<tr><td colspan="5">Aucun contact ne correspond.</td></tr>'}</tbody></table></div>`
}

function vueContact(id) {
  const k = etat.contacts.find((c) => c.id === id)
  if (!k) return `<p class="fil"><a href="#/contacts">← Contacts</a></p><h1>Contact introuvable</h1><p>Cette fiche a peut-être été fusionnée avec une autre.</p>`
  const rs = etat.reponses.filter((r) => r.contactId === k.id).sort((a, b) => b.date - a.date)
  const qs = [...new Set(rs.map((r) => r.qid))].map((qid) => etat.questionnaires.find((q) => q.id === qid)).filter(Boolean)
  const autres = (k.autres || []).map((a) => h(a.email || a.tel))
  return `<p class="fil"><a href="#/contacts">← Contacts</a></p>
    <div class="entete"><h1>${h(k.nom)}</h1></div>
    <div class="fiche">
      <section class="encart"><h2>Coordonnées</h2>
        <dl class="coord"><dt>E-mail</dt><dd>${k.email ? `<a href="mailto:${h(k.email)}">${h(k.email)}</a>` : "—"}</dd>
        <dt>Téléphone</dt><dd>${k.tel ? `<a href="tel:${h(normTel(k.tel))}">${h(k.tel)}</a>` : "—"}</dd>
        ${autres.length ? `<dt>Aussi connu sous</dt><dd>${autres.join("<br>")}</dd>` : ""}
        <dt>Fiche créée</dt><dd>${dateLongue(k.cree)}</dd></dl></section>
      <section class="encart"><h2>Questionnaires répondus</h2>
        <ul class="puces">${qs.map((q) => `<li>${h(q.titre)}</li>`).join("") || "<li>Aucun</li>"}</ul></section>
      <section class="encart large"><h2>Demandes (${rs.length})</h2>
        <ul class="demandes">${rs.map((r) => {
          const q = etat.questionnaires.find((x) => x.id === r.qid)
          return `<li><button type="button" class="carte-ouvrir" data-action="ouvrir-r" data-id="${r.id}"><strong>${h(q ? q.titre : "")}</strong><span class="meta">${quand(r.date)}</span></button>
            <span class="statut s-${r.statut}">${statut(r.statut).lib}</span>${avatar(r.assigne, "petit")}</li>`
        }).join("")}</ul></section>
    </div>`
}

// ---------- vue : questionnaire public ----------
function rendrePublic(param) {
  const point = param.indexOf(".")
  const id = point < 0 ? param : param.slice(0, point)
  let q = etat.questionnaires.find((x) => x.id === id)
  if (!q && point >= 0) { try { q = deballer(id, param.slice(point + 1)) } catch {} }
  if (!q) {
    app.innerHTML = `<main class="public" id="contenu"><div class="formulaire"><h1 class="f-titre">Questionnaire introuvable</h1><p>Le lien est peut-être incomplet.</p></div></main>`
    return
  }
  document.title = q.titre + " (démonstration)"
  app.innerHTML = `<main class="public" id="contenu">
    <form class="formulaire" id="public" novalidate data-id="${h(id)}">${formulaire(q, "f")}
      <button type="submit" class="btn primaire large">Envoyer</button></form>
    <p class="propulse">Questionnaire créé avec Relais · démonstration, rien n'est envoyé à personne</p></main>`
  const form = document.getElementById("public")
  // Le message d'erreur d'un champ disparaît dès qu'on le corrige
  const effacer = (ev) => {
    const c = ev.target.closest(".champ")
    const p = c && c.querySelector(".erreur")
    if (p && !p.hidden) { p.hidden = true; c.querySelectorAll("[aria-invalid]").forEach((e) => e.setAttribute("aria-invalid", "false")) }
  }
  form.addEventListener("input", effacer)
  form.addEventListener("change", effacer)
  form.addEventListener("submit", (ev) => {
    ev.preventDefault()
    const { valeurs, erreurs } = lireFormulaire(form, q, "f")
    if (erreurs.length) {
      const premier = form.querySelector(`#${erreurs[0]}`) || form.querySelector(`#${erreurs[0]}-0`)
      if (premier) premier.focus()
      annoncer(`${erreurs.length} champ${erreurs.length > 1 ? "s" : ""} à corriger.`)
      return
    }
    etat = lire() || etat
    if (!etat.questionnaires.some((x) => x.id === q.id)) etat.questionnaires.push(q)
    const r = enregistrer(etat, q, valeurs)
    etat.derniere = r.id
    ecrire()
    const k = etat.contacts.find((c) => c.id === r.contactId)
    form.outerHTML = `<div class="formulaire merci" tabindex="-1" id="merci"><h1 class="f-titre">Merci, votre réponse est enregistrée.</h1>
      <p>${h(k ? k.nom.split(" ")[0] : "")}${k ? ", nous" : "Nous"} revenons vers vous rapidement.</p>
      <div class="note-demo"><p><strong>Côté démonstration :</strong> dans la vraie application, cette réponse arrive chez l'équipe, sur tous ses appareils. Ici, sans serveur, elle reste dans ce navigateur.</p>
      <p>${r.connu ? "Ce répondant était déjà connu : la réponse a été rattachée à sa fiche." : "Une fiche contact a été créée."}</p>
      <p><a class="btn primaire" href="#/suivi">Voir la carte dans le suivi</a> <a class="btn" href="#/r/${h(param)}" data-action="encore">Répondre à nouveau</a></p></div></div>`
    document.getElementById("merci").focus()
  })
}

// ---------- partage ----------
function partager(id) {
  const q = etat.questionnaires.find((x) => x.id === id)
  if (!q) return
  const url = lienPublic(q)
  dialogue.innerHTML = `<form method="dialog" class="dlg">
    <div class="dlg-tete"><h2 id="dialogue-titre">Partager « ${h(q.titre)} »</h2><button class="icone" value="fermer" aria-label="Fermer">✕</button></div>
    <label class="grand">Lien du questionnaire<input type="text" readonly value="${h(url)}" id="lien-partage"></label>
    <p class="actions"><button type="button" class="btn primaire" data-action="copier">Copier le lien</button>
      <a class="btn" href="${h(url)}" target="_blank" rel="noopener">Ouvrir<span class="sr"> dans un nouvel onglet</span></a></p>
    <div class="qr-zone">${qrSvg(url)}
      <div><p>Scannez-le avec un téléphone : le questionnaire s'ouvre, prêt à remplir. À imprimer sur une affiche, un flyer, un comptoir.</p>
      <p><a class="btn" href="${qrPng(url)}" download="qr-${slug(q.titre)}.png">Télécharger le QR code (PNG)</a></p>
      <p class="aide">Démonstration sans serveur : une réponse envoyée depuis le téléphone reste sur le téléphone. Dans la vraie application, elle arrive ici.</p></div></div>
  </form>`
  if (!dialogue.open) dialogue.showModal()
}

// ---------- annonces ----------
let minuterie
function annoncer(texte) {
  const z = document.getElementById("annonces")
  z.textContent = texte
  z.classList.add("visible")
  clearTimeout(minuterie)
  minuterie = setTimeout(() => z.classList.remove("visible"), 4500)
}

// ---------- événements ----------
document.addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-action]")
  if (!b) return
  const a = b.dataset.action
  const zone = document.querySelector(".edition")
  const q = zone && etat.questionnaires.find((x) => x.id === zone.dataset.q)
  const bloc = b.closest(".bloc-q")
  const i = q && bloc ? q.questions.findIndex((x) => x.id === bloc.dataset.qid) : -1
  if (a === "reinit") {
    if (!confirm("Remettre la démo à zéro ? Vos questionnaires et réponses d'essai seront effacés.")) return
    etat = graine(); ecrire(); filtreQ = filtreA = recherche = ""; location.hash = "#/questionnaires"; rendre()
  } else if (a === "nouveau-q") {
    const n = { id: uid(), titre: "Nouveau questionnaire", description: "", cree: Date.now(), questions: [
      { id: uid(), type: "nom", libelle: "Nom et prénom", obligatoire: true },
      { id: uid(), type: "email", libelle: "E-mail", obligatoire: true },
      { id: uid(), type: "court", libelle: "", obligatoire: false }] }
    etat.questionnaires.push(n); ecrire(); location.hash = "#/questionnaires/" + n.id
  } else if (a === "partager") partager(b.dataset.id)
  else if (a === "copier") {
    const champ = document.getElementById("lien-partage")
    const fait = () => { b.textContent = "Lien copié"; annoncer("Lien copié.") }
    if (navigator.clipboard) navigator.clipboard.writeText(champ.value).then(fait, () => { champ.select(); fait() })
    else { champ.select(); document.execCommand("copy"); fait() }
  } else if (a === "ajout-question" && q) {
    q.questions.push({ id: uid(), type: "court", libelle: "", obligatoire: false }); ecrire(); rendre()
    const champs = document.querySelectorAll('.bloc-q [data-champ="libelle"]'); champs[champs.length - 1].focus()
  } else if (a === "monter" && i > 0) {
    q.questions.splice(i - 1, 0, ...q.questions.splice(i, 1)); ecrire(); rendre(); focaliser(q.questions[i - 1].id, "monter")
  } else if (a === "descendre" && q && i < q.questions.length - 1) {
    q.questions.splice(i + 1, 0, ...q.questions.splice(i, 1)); ecrire(); rendre(); focaliser(q.questions[i + 1].id, "descendre")
  } else if (a === "suppr-question" && i >= 0) {
    q.questions.splice(i, 1); ecrire(); rendre(); annoncer("Question supprimée.")
  } else if (a === "suppr-q" && q) {
    if (!confirm(`Supprimer « ${q.titre} » ? Ses réponses resteront dans le suivi.`)) return
    etat.questionnaires = etat.questionnaires.filter((x) => x.id !== q.id); ecrire(); location.hash = "#/questionnaires"
  } else if (a === "ouvrir-r") ouvrirReponse(b.dataset.id)
  else if (a === "avancer") {
    const r = etat.reponses.find((x) => x.id === b.dataset.id)
    const s = STATUTS[STATUTS.findIndex((x) => x.id === r.statut) + 1]
    if (!r.assigne && s.id === "encours") r.assigne = etat.moi
    changer(r.id, "statut", s.id); annoncer(`Demande passée à « ${s.lib} ».`)
  } else if (a === "fusionner") {
    const k = fusionner(b.dataset.ids.split("+")); ecrire(); rendre(); annoncer(`Fiches fusionnées : ${k.nom}.`)
  } else if (a === "distincts") {
    etat.distincts.push(b.dataset.ids); ecrire(); rendre()
  } else if (a === "fermer-dlg") dialogue.close()
  else if (a === "encore") { setTimeout(rendre, 0) }
})

function focaliser(qid, action) {
  const b = document.querySelector(`.bloc-q[data-qid="${qid}"] [data-action="${action}"]`)
  if (b && !b.disabled) b.focus()
  else { const c = document.querySelector(`.bloc-q[data-qid="${qid}"] [data-champ="libelle"]`); if (c) c.focus() }
}

document.addEventListener("input", (ev) => {
  const t = ev.target
  if (t.id === "recherche") {
    recherche = t.value
    const pos = t.selectionStart
    rendre()
    const r = document.getElementById("recherche"); r.focus(); r.setSelectionRange(pos, pos)
    return
  }
  const zone = t.closest(".edition")
  if (!zone) return
  const q = etat.questionnaires.find((x) => x.id === zone.dataset.q)
  if (t.dataset.champQ) q[t.dataset.champQ] = t.value
  const bloc = t.closest(".bloc-q")
  if (bloc && t.dataset.champ) {
    const x = q.questions.find((y) => y.id === bloc.dataset.qid)
    if (t.dataset.champ === "libelle") x.libelle = t.value
    if (t.dataset.champ === "options") x.options = t.value.split("\n")
  }
  ecrire()
  majApercu()
})

document.addEventListener("change", (ev) => {
  const t = ev.target
  if (t.id === "moi") { etat.moi = t.value; ecrire(); rendre(); return }
  if (t.id === "filtre-q") { filtreQ = t.value; rendre(); return }
  if (t.id === "filtre-a") { filtreA = t.value; rendre(); return }
  if (t.dataset.maj) {
    changer(t.dataset.id, t.dataset.maj, t.value)
    ouvrirReponse(t.dataset.id)
    annoncer(t.dataset.maj === "statut" ? `Statut : ${statut(t.value).lib}.` : (t.value ? `Attribuée à ${utilisateur(t.value).nom}.` : "Plus attribuée."))
    return
  }
  const zone = t.closest(".edition")
  const bloc = t.closest(".bloc-q")
  if (!zone || !bloc) return
  const q = etat.questionnaires.find((x) => x.id === zone.dataset.q)
  const x = q.questions.find((y) => y.id === bloc.dataset.qid)
  if (t.dataset.champ === "obligatoire") { x.obligatoire = t.checked; ecrire(); majApercu() }
  if (t.dataset.champ === "type") {
    const avant = TYPES[x.type].lib
    x.type = t.value
    if (TYPES[x.type].options && !(x.options || []).some((o) => o.trim())) x.options = ["Choix 1", "Choix 2"]
    if (!x.libelle || x.libelle === avant) x.libelle = TYPES[x.type].contact ? TYPES[x.type].lib : x.libelle
    ecrire(); rendre()
    const s = document.querySelector(`.bloc-q[data-qid="${x.id}"] [data-champ="type"]`); if (s) s.focus()
  }
})

// Glisser-déposer entre colonnes (souris) ; au clavier et sur téléphone : le bouton → ou la fenêtre de la carte
document.addEventListener("dragstart", (ev) => {
  const c = ev.target.closest && ev.target.closest(".carte")
  if (!c) return
  ev.dataTransfer.setData("text/plain", c.dataset.rid)
  ev.dataTransfer.effectAllowed = "move"
  c.classList.add("tiree")
})
document.addEventListener("dragend", (ev) => {
  const c = ev.target.closest && ev.target.closest(".carte")
  if (c) c.classList.remove("tiree")
  document.querySelectorAll(".survol").forEach((x) => x.classList.remove("survol"))
})
document.addEventListener("dragover", (ev) => {
  const z = ev.target.closest && ev.target.closest(".cartes")
  if (!z) return
  ev.preventDefault()
  document.querySelectorAll(".survol").forEach((x) => x !== z && x.classList.remove("survol"))
  z.classList.add("survol")
})
document.addEventListener("drop", (ev) => {
  const z = ev.target.closest && ev.target.closest(".cartes")
  if (!z) return
  ev.preventDefault()
  const id = ev.dataTransfer.getData("text/plain")
  const r = etat.reponses.find((x) => x.id === id)
  if (r && r.statut !== z.dataset.statut) {
    if (!r.assigne && z.dataset.statut === "encours") r.assigne = etat.moi
    changer(id, "statut", z.dataset.statut)
    annoncer(`Demande passée à « ${statut(z.dataset.statut).lib} ».`)
  }
})

dialogue.addEventListener("click", (ev) => { if (ev.target === dialogue) dialogue.close() })

// Une réponse envoyée dans un autre onglet (le questionnaire ouvert à côté) arrive ici sans recharger
window.addEventListener("storage", (ev) => {
  if (ev.key !== CLE) return
  const avant = etat.reponses.length
  etat = lire() || etat
  if (route()[0] === "r") return
  if (etat.reponses.length > avant) {
    const r = etat.reponses[etat.reponses.length - 1]
    const k = etat.contacts.find((c) => c.id === r.contactId)
    annoncer(`Nouvelle demande reçue${k ? " : " + k.nom : ""}.`)
  }
  if (!document.querySelector(".edition")) rendre()
})

window.addEventListener("hashchange", () => {
  if (dialogue.open) dialogue.close()
  if (route()[0] !== "r") document.title = "Relais : questionnaires, suivi des demandes et contacts (démonstration)"
  rendre()
  window.scrollTo(0, 0)
})

ecrire()
rendre()
