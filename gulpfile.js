var gulp          = require('gulp');
var browserSync   = require('browser-sync');
var reload        = browserSync.reload;
var sass          = require('gulp-sass');
var autoprefixer  = require('gulp-autoprefixer');

// Static Server
gulp.task('browser-sync', function(){
  browserSync({
    server: {
      baseDir: "./"
    }
  });
});

// Sass task, will run when any SCSS file changes
// will also automatically refresh broswer(s)
gulp.task('sass', function(){
  return gulp.src('theme/scss/**/*.scss')
    .pipe(sass())
    .pipe(autoprefixer({
        broswers: [Chrome>20]
      }))
    .pipe(gulp.dest('theme/css'))
    // reload browser(s)
    .pipe(reload({stream:true}));
});

// Default task(s) to be run by typing "gulp" in terminal
gulp.task('default', function(){

  browserSync({
    server: {
      baseDir: "./"
    }
  });
  gulp.watch(['*.html', 'css/**/*.css', 'js/**/*.js'], {cwd: './'}, reload);
  gulp.watch('theme/scss/**/*.scss', ['sass'], {cwd: './'}, reload);
});