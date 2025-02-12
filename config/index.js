const supportedLanguages = require('./supportedLanguages')

const config = {
  port: process.env.PORT || 5000,
  uploadDir: 'uploads',
  supportedMimeTypes: ['audio/webm', 'audio/mp3', 'audio/wav', 'audio/ogg'],
  maxFileSize: 10 * 1024 * 1024, // 10MB
  supportedLanguages
}

module.exports = config
