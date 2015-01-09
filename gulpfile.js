var gulp          = require('gulp');
var browserSync   = require('browser-sync');

// Static Server
gulp.task('browser-sync', function(){
  browserSync({
    server: {
      baseDir: "./"
    }
  });
});