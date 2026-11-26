function boxStoragePrefix(username) {
    return `rs2b0t:${username}:`;
}

function boxSuffix(key, prefix, id) {
    if (!key.startsWith(prefix) || (id === 'set' && key.includes(':', prefix.length))) return null;
    const suffix = key.slice(prefix.length);
    return id === 'set' ? suffix.replaceAll('%3A', ':').replaceAll('%25', '%') : suffix;
}

function replaceBoxItems(store, keys, { usernames, values }) {
    const boxes = usernames.map(user => ({ user, prefix: boxStoragePrefix(user) }));
    for (const key of keys) {
        if (boxes.some(({ user, prefix }) => boxSuffix(key, prefix, user) !== null)) store.removeItem(key);
    }
    for (const [key, value] of Object.entries(values)) store.setItem(key, value);
}

module.exports = { boxStoragePrefix, boxSuffix, replaceBoxItems };
