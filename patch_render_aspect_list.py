import re

with open("src/js/modules/aspects.js", "r") as f:
    content = f.read()

search_pattern = """            state.aspects.forEach(aspect => {
                const item = document.createElement('div');
                item.className = 'aspect-item' + (aspect.id === state.currentAspectId ? ' active' : '');
                item.onclick = () => selectAspect(aspect.id);

                const iconSrc = aspect.icon || getGenericIcon();

                item.innerHTML = `
                    <img src="${iconSrc}" class="aspect-icon-preview">
                    <span class="aspect-name">${aspect.name}</span>
                `;
                list.appendChild(item);
            });"""

replace_pattern = """            state.aspects.forEach(aspect => {
                const item = document.createElement('div');
                item.className = 'aspect-item' + (aspect.id === state.currentAspectId ? ' active' : '');
                item.onclick = () => selectAspect(aspect.id);

                const iconSrc = aspect.icon || getGenericIcon();

                const img = document.createElement('img');
                img.src = iconSrc;
                img.className = 'aspect-icon-preview';
                item.appendChild(img);

                const span = document.createElement('span');
                span.className = 'aspect-name';
                span.textContent = aspect.name;
                item.appendChild(span);

                list.appendChild(item);
            });"""

if search_pattern in content:
    content = content.replace(search_pattern, replace_pattern)
    with open("src/js/modules/aspects.js", "w") as f:
        f.write(content)
    print("Successfully patched renderAspectList")
else:
    print("Failed to find renderAspectList code to patch")
