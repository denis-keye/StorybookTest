const path = require('path');

module.exports = {
  managerEntries: (entry = []) => [
    ...entry,
    path.resolve(__dirname, './register.ts'),
  ],
  previewAnnotations: (entry = []) => [
    ...entry,
    path.resolve(__dirname, './preview.ts'),
  ],
};
