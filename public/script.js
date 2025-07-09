const API_PROXY = '/api';
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
        const response = await fetch(`${API_PROXY}${url}`, options);
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
    const response = await fetchWithRetry(`/manga/${mangaId}`, { signal: abortController.signal });
    return response.data.attributes.title.en || response.data.attributes.title['ja-ro'];
}

async function getChapterInfo(chapterId) {
    const response = await fetchWithRetry(`/chapter/${chapterId}`, { signal: abortController.signal });
    const mangaId = response.data.relationships.find(rel => rel.type === 'manga').id;
    const mangaTitle = await getMangaTitle(mangaId);
    return {
        mangaTitle,
        chapterTitle: response.data.attributes.title,
        chapterNum: response.data.attributes.chapter,
        volume: response.data.attributes.volume
    };
}

async function getChapterPages(chapterId) {
    const response = await fetchWithRetry(`/at-home/server/${chapterId}`, { signal: abortController.signal });
    return {
        baseUrl: response.baseUrl,
        hash: response.chapter.hash,
        data: response.chapter.data
    };
}

function generateFileName(info) {
    const includeVolume = document.getElementById('includeVolume').checked;
    let fileName = info.mangaTitle;
    
    if (includeVolume && info.volume) {
        fileName += ` (Vol. ${info.volume})`;
    }
    
    fileName += ` - Chapter ${info.chapterNum}`;
    
    return fileName;
}

async function downloadImage(url, options = {}) {
    const proxiedUrl = `/image?url=${encodeURIComponent(url)}`;
    const response = await fetch(proxiedUrl, options);
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

    for (let i = 0; i < images.length; i++) {
        const imageData = URL.createObjectURL(images[i]);
        const img = new Image();
        img.src = imageData;

        await new Promise((resolve) => {
            img.onload = () => {
                const imgWidth = img.naturalWidth;
                const imgHeight = img.naturalHeight;

                pdf.setPage(i + 1);
                pdf.internal.pageSize.setWidth(imgWidth);
                pdf.internal.pageSize.setHeight(imgHeight);
                
                pdf.addImage(
                    img,
                    'PNG',
                    0,
                    0,
                    imgWidth,
                    imgHeight
                );

                if (i < images.length - 1) pdf.addPage();
                resolve();
            };
        });
    }

    return pdf;
}

async function downloadChapter(chapterId, language, signal, chapterIndex = null, totalChapters = null) {
    const info = await getChapterInfo(chapterId);
    const pages = await getChapterPages(chapterId);

    let downloadedImages = 0;
    const totalImages = pages.data.length;

    const imagePromises = pages.data.map((page, index) => {
        const url = `${pages.baseUrl}/data/${pages.hash}/${page}`;
        return downloadImage(url, { signal }).then(image => {
            downloadedImages++;
            updateProgress((downloadedImages / totalImages) * 100);
            
            if (chapterIndex !== null && totalChapters !== null) {
                updateStatus(`Chapter ${chapterIndex}/${totalChapters} - Downloaded ${downloadedImages}/${totalImages} images`);
            } else {
                updateStatus(`Downloaded ${downloadedImages} of ${totalImages} images`);
            }
            return image;
        });
    });

    const images = await Promise.all(imagePromises);
    updateStatus('Creating files...');

    const fileName = generateFileName(info);

    if (document.getElementById('cbz').checked) {
        const cbz = await createCBZ(images, info.mangaTitle);
        const link = document.createElement('a');
        link.href = URL.createObjectURL(cbz);
        link.download = `${fileName}.cbz`;
        link.click();
    }

    if (document.getElementById('pdf').checked) {
        const pdf = await createPDF(images, info.mangaTitle);
        const pdfBlob = pdf.output('blob');

        const link = document.createElement('a');
        link.href = URL.createObjectURL(pdfBlob);
        link.download = `${fileName}.pdf`;
        link.style.display = 'none';

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    // Always update status to show completion - batch downloads will override this later
    updateStatus('Download completed!');

    return {
        success: true,
        chapterNum: info.chapterNum,
        fileName: fileName
    };
}

async function getChapterList(mangaId, startChapter, endChapter, startVolume, endVolume, language = 'en', signal) {
    const chapterList = [];
    const seenChapters = new Set();
    let offset = 0;
    const limit = 100;
    const contentRatings = ['safe', 'suggestive', 'erotica', 'pornographic'];
    const apiBaseUrl = API_PROXY;

    while (true) {
        const params = new URLSearchParams({
            limit: limit.toString(),
            offset: offset.toString(),
            'translatedLanguage[]': language,
            'order[chapter]': 'asc'
        });
        
        contentRatings.forEach(rating => {
            params.append('contentRating[]', rating);
        });

        const url = `${apiBaseUrl}/manga/${mangaId}/feed?${params.toString()}`;

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/vnd.api+json',
                    'User-Agent': 'manga-fetch-agent'
                },
                signal: signal
            });

            if (!response.ok) {
                break;
            }

            const data = await response.json();
            const chaptersData = data.data || [];

            for (const chapterData of chaptersData) {
                processChapter(chapterData);
            }

            if (chaptersData.length < limit) {
                break;
            }

            offset += limit;

        } catch (error) {
            break;
        }
    }

    return chapterList
        .sort((a, b) => parseFloat(a[1]) - parseFloat(b[1]))
        .map(chapter => ({ id: chapter[0], num: chapter[1] }));

    function processChapter(chapterData) {
        const chapterId = chapterData.id;
        const chapterNum = chapterData.attributes.chapter;
        const volumeNum = chapterData.attributes.volume;
        const externalChapter = chapterData.attributes.externalUrl;

        if (!chapterNum || externalChapter) {
            return { added: false };
        }

        const chapterNumFloat = parseFloat(chapterNum);
        if (isNaN(chapterNumFloat)) {
            return { added: false };
        }

        if (seenChapters.has(chapterNum)) {
            return { added: false };
        }

        // Chapter range filtering
        if (startChapter != null && chapterNumFloat < startChapter) {
            return { added: false };
        }
        if (endChapter != null && chapterNumFloat > endChapter) {
            return { added: false };
        }

        // Volume filtering - FIXED: Properly exclude chapters without volume info when volume filtering is active
        if (startVolume != null || endVolume != null) {
            if (volumeNum) {
                const volumeNumFloat = parseFloat(volumeNum);
                if (!isNaN(volumeNumFloat)) {
                    if (startVolume != null && volumeNumFloat < startVolume) {
                        return { added: false };
                    }
                    if (endVolume != null && volumeNumFloat > endVolume) {
                        return { added: false };
                    }
                } else {
                    return { added: false };
                }
            } else {
                // Exclude chapters without volume info when volume filtering is active
                return { added: false };
            }
        }

        chapterList.push([chapterId, chapterNum]);
        seenChapters.add(chapterNum);
        
        return { added: true };
    }
}

async function handleBatchDownload(mangaId, language, signal) {
    const startChapter = parseFloat(document.getElementById('startChapter').value) || null;
    const endChapter = parseFloat(document.getElementById('endChapter').value) || null;
    const startVolume = parseFloat(document.getElementById('startVolume').value) || null;
    const endVolume = parseFloat(document.getElementById('endVolume').value) || null;

    const statusContainer = document.getElementById('chapterStatus');
    statusContainer.innerHTML = '';

    const chapterStatusElement = document.createElement('div');
    statusContainer.appendChild(chapterStatusElement);

    function updateChapterStatus(message) {
        chapterStatusElement.textContent = message;
    }

    updateChapterStatus('Getting chapter list...');
    const chapters = await getChapterList(mangaId, startChapter, endChapter, startVolume, endVolume, language, signal);
    
    const results = {
        successful: [],
        failed: []
    };

    for (let i = 0; i < chapters.length; i++) {
        const chapter = chapters[i];
        const maxRetries = 3;
        let retryCount = 0;
        let success = false;

        while (!success && retryCount < maxRetries) {
            try {
                updateChapterStatus(`Downloading chapter ${chapter.num} (${i + 1}/${chapters.length})${retryCount > 0 ? ` - Retry ${retryCount}` : ''}`);
                
                const result = await downloadChapter(chapter.id, language, signal, i + 1, chapters.length);
                
                if (result.success) {
                    success = true;
                    results.successful.push({
                        chapterNum: chapter.num,
                        fileName: result.fileName
                    });
                }
            } catch (error) {
                retryCount++;
                
                if (error.name === 'AbortError') {
                    updateChapterStatus('Batch Download Aborted.');
                    return;
                }
                
                if (retryCount < maxRetries) {
                    updateChapterStatus(`Retrying chapter ${chapter.num} (${retryCount}/${maxRetries})...`);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                } else {
                    results.failed.push({
                        chapterNum: chapter.num,
                        error: error.message
                    });
                }
            }
        }
    }

    const successCount = results.successful.length;
    const failedCount = results.failed.length;
    const totalCount = chapters.length;

    let finalMessage = `Done! ${successCount}/${totalCount} chapters successful`;
    if (failedCount > 0) {
        finalMessage += `, ${failedCount} failed`;
    }

    updateStatus('');
    updateChapterStatus(finalMessage);
}

document.getElementById('download').addEventListener('click', async function () {
    const button = this;
    
    if (button.textContent === 'Go!') {
        button.textContent = 'Stop!';
        button.classList.add('stop');

        try {
            const url = document.getElementById('mangaUrl').value.trim();
            const language = document.getElementById('language').value.trim() || 'en';

            abortController = new AbortController();
            const signal = abortController.signal;

            const titleMatch = url.match(/title\/([a-f0-9\-]+)/i);
            const chapterMatch = url.match(/chapter\/([a-f0-9\-]+)/i);

            if (titleMatch) {
                const mangaId = titleMatch[1];
                await handleBatchDownload(mangaId, language, signal);
            } else if (chapterMatch) {
                const chapterId = chapterMatch[1];
                try {
                    await downloadChapter(chapterId, language, signal);
                    // Status is already updated inside downloadChapter for single downloads
                } catch (error) {
                    if (error.name === 'AbortError') {
                        updateStatus('Download Aborted.');
                    } else {
                        updateStatus(`Error: ${error.message}`);
                    }
                }
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
        abortController.abort();
        resetButton(button);
    }
});

function resetButton(button) {
    button.textContent = 'Go!';
    button.classList.remove('stop');
}