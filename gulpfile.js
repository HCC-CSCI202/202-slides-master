var gulp          = require('gulp');
var browserSync   = require('browser-sync');
var reload        = browserSync.reload;
var sass          = require('gulp-sass');
var autoprefixer  = require('gulp-autoprefixer');
var rename        = require('gulp-rename');
var minifycss     = require('gulp-minify-css');
var uglify        = require('gulp-uglify');
var concat        = require('gulp-concat');

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

    .pipe(sass({ style: 'expanded' }))
    // add vendor prefixes

    .pipe(autoprefixer({
      }))

    // save resulting css files
    .pipe(gulp.dest('theme/css'))

    // rename css files with a .min suffix
    .pipe(rename({ suffix: '.min' }))
    .pipe(minifycss())
    .pipe(gulp.dest('dist/css'))

    // reload browser(s)
    .pipe(reload({stream:true}));
});

gulp.task('js', function(){
  return gulp.src('js/**/*.js')

    //combine all js into a single file
    .pipe(concat('main.js'))
    //save un-uglified version to js folder
    .pipe(gulp.dest('js'))
    //rename un-uglifed version to .min prior to uglifying
    .pipe(rename({ suffix: '.min' }))
    .pipe(uglify())
    //save uglified version to the dist folder
    .pipe(gulp.dest('dist/js'))
    

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
  gulp.watch(['*.html', 'css/**/*.css'], {cwd: './'}, reload);
  gulp.watch('theme/scss/**/*.scss', ['sass'], {cwd: './'}, reload);
  gulp.watch('js/**/*.js', ['js'], {cwd: './'}, reload);
});