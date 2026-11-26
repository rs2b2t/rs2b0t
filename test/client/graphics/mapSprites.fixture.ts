import JagFile from '#/client/io/JagFile.js';

export function mapSpriteArchive(): JagFile {
    const index: number[] = [];
    const names = ['mapscene.dat', 'mapfunction.dat'];
    const sheets = names.map((_, sheet) => {
        const data = [index.length >> 8, index.length & 255];
        index.push(0, 20 + sheet, 0, 24, 64);
        for (let colour = 1; colour < 64; colour++) {
            if (colour === 1) index.push(0, 0, 0);
            else index.push(colour + sheet, colour * 2, 255 - colour);
        }
        for (let i = 0; i < 50; i++) {
            const width = 12 + i % 3;
            const height = 12 + i % 4;
            index.push(i % 4, i % 5, 0, width, 0, height, i % 2);
            for (let pixel = 0; pixel < width * height; pixel++) data.push((i + pixel + sheet) % 64);
        }
        return Uint8Array.from(data);
    });

    const archive = new JagFile(new Uint8Array(8));
    archive.fileHash = [...names, 'index.dat'].map(JagFile.genHash);
    archive.fileCount = archive.fileHash.length;
    archive.fileUnpacked = [...sheets, Uint8Array.from(index)];
    return archive;
}
