// Функция для конвертации RGB в HEX-формат
function rgbToHex(rgb) {
    if (!rgb || typeof rgb.r !== 'number' || typeof rgb.g !== 'number' || typeof rgb.b !== 'number') {
        throw new TypeError('Invalid RGB value');
    }

    const toHex = (component) => {
        const hex = Math.round(component * 255).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    };

    const { r, g, b } = rgb;
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Функция для конвертации RGB в RGBA-формат
function rgbToRgba(rgb) {
    if (!rgb || typeof rgb.r !== 'number' || typeof rgb.g !== 'number' || typeof rgb.b !== 'number' || typeof rgb.a !== 'number') {
        throw new TypeError('Invalid RGBA value');
    }

    const r = Math.round(rgb.r * 255);
    const g = Math.round(rgb.g * 255);
    const b = Math.round(rgb.b * 255);
    const a = rgb.a.toFixed(2); // Преобразуем альфа-канал в строку с двумя знаками после запятой

    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// Функция для определения формата цвета (HEX или RGBA)
function formatColor(value) {
    if (value.a !== undefined && value.a < 1) {
        // Если присутствует альфа-канал и он меньше 1, используем RGBA
        return rgbToRgba(value);
    } else {
        // Иначе возвращаем HEX
        return rgbToHex(value);
    }
}

// Функция для разрешения алиасов переменных
async function resolveAlias(value) {
    if (value && value.type === "VARIABLE_ALIAS") {
        // Если это алиас, получаем исходную переменную по ID
        const resolvedVariable = await figma.variables.getVariableByIdAsync(value.id);
        if (resolvedVariable) {
            const modeId = Object.keys(resolvedVariable.valuesByMode)[0]; // Получаем первое доступное значение для mode
            return {
                aliasName: resolvedVariable.name, // Возвращаем имя переменной, на которую ссылается алиас
                value: resolvedVariable.valuesByMode[modeId].value
            };
        }
    }
    return value;
}

// Функция для извлечения группы переменной и её нового имени
function getVariableInfo(fullName) {
    const parts = fullName.split('/');
    const group = parts.slice(0, -1).join(' '); // Извлекаем категорию, как комментарий
    const name = parts[parts.length - 1]; // Имя переменной (последняя часть)
    return { group, name };
}

// Функция для обработки строк без кавычек
function formatStringValue(value) {
    return value;
}

// Функция для получения всех переменных и их коллекций в порядке, как они указаны в Figma
async function getVariablesAndCollections() {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    let variablesList = [];

    // Проходим по каждой коллекции и добавляем переменные в список в правильном порядке
    for (const collection of collections) {
        const variables = collection.variableIds.map(id => figma.variables.getVariableByIdAsync(id));
        const resolvedVariables = await Promise.all(variables);
        variablesList.push({ collection, variables: resolvedVariables });
    }

    return variablesList;
}

// Асинхронный экспорт локальных переменных в CSS с сохранением группировки
async function exportGlobalVariablesToCSS(addPx) {
    try {
        console.log('Начинаем экспорт CSS'); // Лог для отладки
        const variablesAndCollections = await getVariablesAndCollections();  // Используем асинхронный метод

        if (variablesAndCollections.length === 0) {
            figma.notify('No local variables found.');
            return '';
        }

        let cssVariables = '';
        const renderedGroups = new Set(); // Множество для отслеживания уже выведенных групп
        const groupsOrder = [ // Правильный порядок групп, как показано на изображении
            'Theme colors',
            'Content',
            'Font sizes',
            'Support colors',
            'UI Sizes',
            'UI Colors',
            'Buttons',
            'UI Borders'
        ];

        for (const groupName of groupsOrder) {
            for (const { collection, variables } of variablesAndCollections) {
                for (const variable of variables) {
                    const { name, resolvedType, valuesByMode } = variable;

                    for (const modeId in valuesByMode) {
                        let value = valuesByMode[modeId];

                        // Извлекаем группу переменной и её новое имя
                        const { group, name: newName } = getVariableInfo(name);

                        // Проверяем, если текущая переменная относится к текущей группе
                        if (group === groupName) {
                            // Если группа переменной изменилась и она не была ещё выведена
                            if (!renderedGroups.has(group)) {
                                cssVariables += `\n/* ${group} */\n`;
                                renderedGroups.add(group); // Отмечаем группу как выведенную
                            }

                            // Если это алиас, разрешаем его
                            const resolvedAlias = await resolveAlias(value);

                            if (resolvedAlias && resolvedAlias.aliasName) {
                                // Получаем короткое имя для алиаса (без категории)
                                const { name: aliasShortName } = getVariableInfo(resolvedAlias.aliasName);
                                // Экспортируем алиас как строку с указанием ссылки на другую переменную
                                cssVariables += `--${newName}: var(--${aliasShortName});\n`;
                                continue;  // Переходим к следующей переменной
                            }

                            // Обработка группы UI Sizes
                            if (group === 'UI Sizes' && resolvedType === 'FLOAT' && addPx) {
                                cssVariables += `--${newName}: ${value}px;\n`;
                            } else if (resolvedType === 'COLOR') {
                                if (value && value.r !== undefined && value.g !== undefined && value.b !== undefined) {
                                    const formattedColor = formatColor(value); // Проверка формата (HEX или RGBA)
                                    cssVariables += `--${newName}: ${formattedColor};\n`;
                                } else {
                                    console.warn(`Skipping invalid color value for variable: ${name}`);
                                }
                            } else if (resolvedType === 'FLOAT') {
                                cssVariables += `--${newName}: ${value};\n`;
                            } else if (resolvedType === 'STRING') {
                                if (typeof value === 'string' || value !== null) {
                                    cssVariables += `--${newName}: ${formatStringValue(value)};\n`;
                                } else {
                                    console.warn(`Skipping invalid string value for variable: ${name}`);
                                }
                            } else {
                                cssVariables += `--${newName}: ${value};\n`;
                            }
                        }
                    }
                }
            }
        }

        return cssVariables;

    } catch (error) {
        console.error('Error fetching local variables:', error);
        return '';
    }
}

// Отображаем интерфейс с высотой 400px
figma.showUI(__html__, { width: 480, height: 400 });

figma.ui.onmessage = async (msg) => {
    console.log('Получено сообщение от UI:', msg); // Лог для отладки
    if (msg.type === 'export-css') {
        const css = await exportGlobalVariablesToCSS(msg.addPx);
        if (css !== '') {
            figma.ui.postMessage({ type: 'exported-css', css });
            console.log('CSS экспортирован'); // Лог для отладки
        } else {
            figma.ui.postMessage({ type: 'error', message: 'No variables to export.' });
            console.log('Ошибка: нет переменных для экспорта'); // Лог для отладки
        }
    }
};