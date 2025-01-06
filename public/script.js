const API_BASE = '/api';
const statusElement = document.getElementById('status');
const progress = document.getElementById('progress');
const progressBar = document.getElementById('progress-bar');
let abortController = new AbortController();

function updateStatus(message) {
    statusElement.textContent = message;
}

function updateProgress(percent) {
    progress.style.display = 'block';
    progressBar.style.width = `${percent}%`;
}

async function fetchWithRetry(url, options = {}, retries = 3) {
    try {
        options.signal?.throwIfAborted();
        const response = await fetch(url, options);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return await response.json();
    } catch (error) {
        if (retries > 0 && error.name !== 'AbortError') {
            await new Promise(resolve => setTimeout(resolve, 1000));
            return fetchWithRetry(url, options, retries - 1);
        }
        throw error;
    }
}

async function getMangaTitle(mangaId) {
    const response = await fetchWithRetry(`${API_BASE}/manga/${mangaId}`, { signal: abortController.signal });
    return response.data.attributes.title.en || response.data.attributes.title['ja-ro'];
}

async function getChapterInfo(chapterId) {
    const response = await fetchWithRetry(`${API_BASE}/chapter/${chapterId}`, { signal: abortController.signal });
    const mangaId = response.data.relationships.find(rel => rel.type === 'manga').id;
    const mangaTitle = await getMangaTitle(mangaId);
    return {
        mangaTitle,
        chapterTitle: response.data.attributes.title,
        chapterNum: response.data.attributes.chapter
    };
}

async function getChapterPages(chapterId) {
    const response = await fetchWithRetry(`${API_BASE}/at-home/server/${chapterId}`, { signal: abortController.signal });
    return {
        baseUrl: response.baseUrl,
        hash: response.chapter.hash,
        data: response.chapter.data
    };
}

async function downloadImage(url, options = {}) {
    const response = await fetch(url, options);
    const blob = await response.blob();
    return blob;
}

async function createCBZ(images, title) {
    const zip = new JSZip();
    images.forEach((image, index) => {
        zip.file(`page_${index + 1}.png`, image);
    });
    return await zip.generateAsync({ type: 'blob' });
}

async function createPDF(images, title) {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF();
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    for (let i = 0; i < images.length; i++) {
        const imageData = URL.createObjectURL(images[i]);
        const img = new Image();
        img.src = imageData;

        await new Promise((resolve) => {
            img.onload = () => {
                const imgProps = {
                    width: img.naturalWidth,
                    height: img.naturalHeight
                };

                const dimensions = fitImageToPage(imgProps, pageWidth, pageHeight);

                pdf.addImage(
                    img,
                    'PNG',
                    (pageWidth - dimensions.width) / 2,
                    (pageHeight - dimensions.height) / 2,
                    dimensions.width,
                    dimensions.height
                );

                if (i < images.length - 1) pdf.addPage();
                resolve();
            };
        });
    }

    return pdf;
}

function fitImageToPage(imgProps, pageWidth, pageHeight) {
    const aspectRatio = imgProps.width / imgProps.height;
    let targetWidth = pageWidth;
    let targetHeight = pageHeight;

    if (targetWidth / aspectRatio <= pageHeight) {
        targetHeight = targetWidth / aspectRatio;
    } else {
        targetWidth = targetHeight * aspectRatio;
    }

    return {
        width: targetWidth,
        height: targetHeight
    };
}

async function downloadChapter(chapterId, language, signal) {
    try {
        const info = await getChapterInfo(chapterId);
        const pages = await getChapterPages(chapterId);

        let downloadedImages = 0;
        const totalImages = pages.data.length;

        const imagePromises = pages.data.map((page, index) => {
            const url = `${pages.baseUrl}/data/${pages.hash}/${page}`;
            return downloadImage(url, { signal }).then(image => {
                downloadedImages++;
                updateProgress((downloadedImages / totalImages) * 100);
                updateStatus(`Downloaded ${downloadedImages} of ${totalImages} images`);
                return image;
            });
        });

        const images = await Promise.all(imagePromises);

        updateStatus('Creating files...');

        if (document.getElementById('cbz').checked) {
            const cbz = await createCBZ(images, info.mangaTitle);
            const link = document.createElement('a');
            link.href = URL.createObjectURL(cbz);
            link.download = `${info.mangaTitle} - Chapter ${info.chapterNum}.cbz`;
            link.click();
        }

        if (document.getElementById('pdf').checked) {
            const pdf = await createPDF(images, info.mangaTitle);
            const pdfBlob = pdf.output('blob');

            const link = document.createElement('a');
            link.href = URL.createObjectURL(pdfBlob);
            link.download = `${info.mangaTitle} - Chapter ${info.chapterNum}.pdf`;
            link.style.display = 'none';

            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            updateStatus('PDF created!');
        }

        updateStatus('Download complete!');
    } catch (error) {
        if (error.name === 'AbortError') {
            updateStatus('Download Aborted.');
        } else {
            updateStatus(`Error: ${error.message}`);
        }
        console.error(error);
    }
}

async function getChapterList(mangaId, startChapter, endChapter, language, signal) {
    const chapters = [];
    let offset = 0;

    while (true) {
        const response = await fetchWithRetry(
            `${API_BASE}/manga/${mangaId}/feed?limit=500&offset=${offset}&translatedLanguage[]=${language}`,
            { signal }
        );

        const newChapters = response.data
            .filter(chapter => {
                const num = parseFloat(chapter.attributes.chapter);
                return (!startChapter || num >= startChapter) &&
                    (!endChapter || num <= endChapter) &&
                    !chapter.attributes.externalUrl;
            })
            .map(chapter => ({
                id: chapter.id,
                num: parseFloat(chapter.attributes.chapter)
            }));

        chapters.push(...newChapters);

        if (!response.links || !response.links.next) break;
        offset += 500;
    }

    return chapters.sort((a, b) => a.num - b.num).map(c => c.id);
}

async function handleBatchDownload(mangaId, language, signal) {
    const startChapter = parseFloat(document.getElementById('startChapter').value) || null;
    const endChapter = parseFloat(document.getElementById('endChapter').value) || null;

    const statusContainer = document.getElementById('chapterStatus');
    statusContainer.innerHTML = ''; // Clear any previous messages

    const chapterStatusElement = document.createElement('div');
    statusContainer.appendChild(chapterStatusElement);

    function updateChapterStatus(message) {
        chapterStatusElement.textContent = message;
    }

    try {
        updateChapterStatus('Getting chapter list...');
        const chapters = await getChapterList(mangaId, startChapter, endChapter, language, signal);

        for (let i = 0; i < chapters.length; i++) {
            updateChapterStatus(`Downloading chapter ${i + 1} of ${chapters.length}`);
            await downloadChapter(chapters[i], language, signal);
        }

        updateChapterStatus('All chapters downloaded!');
    } catch (error) {
        if (error.name === 'AbortError') {
            updateChapterStatus('Batch Download Aborted.');
        } else {
            updateChapterStatus(`Error: ${error.message}`);
        }
        console.error(error);
    }
}

document.getElementById('download').addEventListener('click', async function () {
    const button = this;
    
    if (button.textContent === 'Go!') {
        button.textContent = 'Stop!';
        button.classList.add('stop');

        try {
            const url = document.getElementById('mangaUrl').value.trim();
            const language = document.getElementById('language').value.trim() || 'en';

            // Regenerate AbortController for new operations
            abortController = new AbortController();
            const signal = abortController.signal;

            const titleMatch = url.match(/title\/([a-f0-9\-]+)/i);
            const chapterMatch = url.match(/chapter\/([a-f0-9\-]+)/i);

            if (titleMatch) {
                const mangaId = titleMatch[1];
                await handleBatchDownload(mangaId, language, signal);
            } else if (chapterMatch) {
                const chapterId = chapterMatch[1];
                await downloadChapter(chapterId, language, signal);
            } else {
                updateStatus('Invalid URL format');
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                updateStatus('Operation Aborted.');
            } else {
                updateStatus(`Error: ${error.message}`);
            }
        } finally {
            resetButton(button);
        }
    } else {
        // Abort signal when "Stop!" is clicked
        abortController.abort();
        resetButton(button);
    }
});

function resetButton(button) {
    button.textContent = 'Go!';
    button.classList.remove('stop');
}