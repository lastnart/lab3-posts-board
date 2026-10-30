'use strict';

const POSTS_URL = 'https://jsonplaceholder.typicode.com/posts';
const GET_URL = `${POSTS_URL}?_limit=5`;

const loadBtn = document.getElementById('load-btn');
const submitBtn = document.getElementById('submit-btn');
const form = document.getElementById('post-form');
const titleInput = document.getElementById('title');
const bodyInput = document.getElementById('body');
const postsList = document.getElementById('posts');
const postsEmpty = document.getElementById('posts-empty');
const resultBox = document.getElementById('result');
const messageBox = document.getElementById('message');

// ---------- Сообщения и состояние кнопок ----------
function showMessage(text, type) {
  messageBox.textContent = text;
  messageBox.className = `message ${type}`;
  messageBox.hidden = false;
}

function setBusy(busy) {
  loadBtn.disabled = busy;
  submitBtn.disabled = busy;
}

// ---------- Запрос: проверка response.ok и разбор JSON ----------
async function request(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return { status: response.status, data: await response.json() };
}

function describeError(error) {
  if (error instanceof TypeError) {
    return 'Не удалось связаться с сервером. Проверьте подключение к интернету и попробуйте снова.';
  }
  if (/^HTTP 404/.test(error.message)) {
    return 'Ошибка 404: адрес не найден. Попробуйте снова.';
  }
  if (/^HTTP \d+/.test(error.message)) {
    return `Сервер вернул ошибку (${error.message}). Попробуйте снова.`;
  }
  return `Произошла ошибка: ${error.message}`;
}

// ---------- Отображение публикаций через DOM ----------
function createPostElement(post, isNew) {
  const li = document.createElement('li');
  li.className = isNew ? 'post new' : 'post';

  const title = document.createElement('h3');
  title.textContent = post.title;
  const body = document.createElement('p');
  body.textContent = post.body;
  li.append(title, body);
  return li;
}

// Карточка с ответом сервера на POST
function showResult(post) {
  const badge = document.createElement('div');
  badge.className = 'badge';
  badge.textContent = 'Ответ сервера получен';
  const title = document.createElement('h3');
  title.textContent = post.title;
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = `ID: ${post.id}`;
  resultBox.replaceChildren(badge, title, meta);
  resultBox.hidden = false;
}

function updateEmptyState() {
  postsEmpty.hidden = postsList.children.length > 0;
}

// ---------- GET ----------
async function loadPosts() {
  setBusy(true);
  showMessage('Загрузка публикаций…', 'loading');
  try {
    const { status, data: posts } = await request(GET_URL);
    postsList.replaceChildren(...posts.map((p) => createPostElement(p, false)));
    showMessage(`Успешно: GET /posts?_limit=5 — HTTP ${status}, публикаций: ${posts.length}.`, 'success');
  } catch (error) {
    showMessage(describeError(error), 'error');
  } finally {
    setBusy(false);
    updateEmptyState();
  }
}

// ---------- POST ----------
async function createPost(title, body) {
  setBusy(true);
  showMessage('Отправка публикации…', 'loading');
  try {
    const { status, data: created } = await request(POSTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body, userId: 1 })
    });
    showResult(created);
    showMessage(`Успешно: POST /posts — HTTP ${status}. Публикация создана, ID: ${created.id}.`, 'success');
    form.reset();
  } catch (error) {
    showMessage(describeError(error), 'error');
  } finally {
    setBusy(false);
    updateEmptyState();
  }
}

// ---------- События ----------
loadBtn.addEventListener('click', loadPosts);

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const title = titleInput.value.trim();
  const body = bodyInput.value.trim();
  if (!title || !body) {
    showMessage('Заполните заголовок и текст: поля не должны быть пустыми.', 'error');
    return; // запрос не отправляется
  }
  createPost(title, body);
});
