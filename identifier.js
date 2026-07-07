function mergeSort(array, cmp) {
    if (array.length < 2) return array.slice();
    function merge(a, b) {
        var r = [],
            ai = 0,
            bi = 0,
            i = 0;
        while (ai < a.length && bi < b.length) {
            cmp(a[ai], b[bi]) <= 0 ? (r[i++] = a[ai++]) : (r[i++] = b[bi++]);
        }
        if (ai < a.length) r.push.apply(r, a.slice(ai));
        if (bi < b.length) r.push.apply(r, b.slice(bi));
        return r;
    }
    function _ms(a) {
        if (a.length <= 1) return a;
        var m = Math.floor(a.length / 2),
            left = a.slice(0, m),
            right = a.slice(m);
        left = _ms(left);
        right = _ms(right);
        return merge(left, right);
    }
    return _ms(array);
}

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}

export const nth_identifier = (() => {
    let leading = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ$_'.split('');
    let digits = '0123456789'.split('');
    shuffle(leading);
    shuffle(digits);

    let chars;
    let frequency;
    function reset() {
        frequency = new Map();
        leading.forEach(ch => frequency.set(ch, 0));
        digits.forEach(ch => frequency.set(ch, 0));
    }
    function consider(str, delta) {
        for (var i = str.length; --i >= 0; ) {
            frequency.set(str[i], frequency.get(str[i]) + delta);
        }
    }
    function compare(a, b) {
        return frequency.get(b) - frequency.get(a);
    }
    function sort() {
        chars = mergeSort(leading, compare).concat(mergeSort(digits, compare));
    }

    reset();
    sort();

    function baseN(num) {
        // comment out this code if you want stability between runs
        if (num === 0) {
            reset();
            sort();
        }

        var ret = '',
            base = 54;
        num++;

        do {
            num--;
            ret += chars[num % base];
            num = Math.floor(num / base);
            base = 64;
        } while (num > 0);
        return ret;
    }

    return {
        get: baseN,
        consider,
        reset,
        sort
    };
})();
